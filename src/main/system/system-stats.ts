import { exec } from 'node:child_process';
import * as os from 'node:os';
import { promisify } from 'node:util';
import type { ProcessStats, SystemStats } from '@shared/system-stats';

const execAsync = promisify(exec);

// Cache for tracking CPU time per PID to calculate percentage
interface CpuSample {
  time: number; // timestamp in ms
  cpuTime: number; // cumulative CPU time in seconds
}

const cpuCache = new Map<number, CpuSample>();

/**
 * Get current system resource usage statistics.
 */
export async function getSystemStats(): Promise<SystemStats> {
  // Get CPU usage
  const cpuPercent = await getCpuUsage();

  // Get memory usage
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;

  return {
    cpuPercent: Math.round(cpuPercent * 10) / 10, // Round to 1 decimal
    memoryUsed: usedMemory,
    memoryTotal: totalMemory,
  };
}

/**
 * Get resource usage for specific PIDs (Nestbox-managed processes).
 */
export async function getProcessStats(pids: readonly number[]): Promise<ProcessStats> {
  if (pids.length === 0) {
    return { cpuPercent: 0, memoryUsed: 0 };
  }

  const platform = os.platform();

  try {
    if (platform === 'win32') {
      return await getProcessStatsWindows(pids);
    } else if (platform === 'darwin' || platform === 'linux') {
      return await getProcessStatsUnix(pids);
    }
  } catch (error) {
    // Silently fail and return zeros if we can't get process stats
    console.error('Failed to get process stats:', error);
  }

  return { cpuPercent: 0, memoryUsed: 0 };
}

/**
 * Get process stats on Windows using PowerShell.
 * Gets stats for the PIDs and all their descendants.
 */
async function getProcessStatsWindows(pids: readonly number[]): Promise<ProcessStats> {
  if (pids.length === 0) return { cpuPercent: 0, memoryUsed: 0 };

  // First, get all descendant PIDs
  const pidList = pids.join(',');
  const allPids = new Set<number>(pids);

  try {
    // Get child processes recursively
    const psScript = '$parents = @(' + pidList + '); $seen = @{}; while ($parents.Count -gt 0) { $current = $parents[0]; $parents = $parents[1..($parents.Count-1)]; if ($seen[$current]) { continue }; $seen[$current] = $true; $children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $current } | Select-Object -ExpandProperty ProcessId; if ($children) { if ($children -is [array]) { $parents += $children } else { $parents += @($children) } } }; $seen.Keys -join \',\'';
    const { stdout: childStdout } = await execAsync(
      `powershell -NoProfile -Command "${psScript}"`,
      { timeout: 5000 }
    );

    // Add descendants to the set
    const descendants = childStdout.trim().split(',').filter(Boolean);
    console.log('Descendants found:', descendants);
    for (const pidStr of descendants) {
      const pid = parseInt(pidStr, 10);
      if (!isNaN(pid)) allPids.add(pid);
    }
  } catch (error) {
    console.error('Failed to get child processes:', error);
    // Continue with just the parent PIDs
  }

  if (allPids.size === 0) return { cpuPercent: 0, memoryUsed: 0 };

  console.log('All PIDs to track:', Array.from(allPids));

  // Now get stats for all PIDs (parents + descendants)
  const allPidList = Array.from(allPids).join(',');
  const { stdout } = await execAsync(
    'powershell -NoProfile -Command "Get-Process -Id ' + allPidList + ' -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64,CPU | ConvertTo-Csv -NoTypeInformation"',
    { timeout: 5000 }
  );

  console.log('PowerShell output:', stdout);

  let totalMemory = 0;
  let totalCpuPercent = 0;
  const now = Date.now();

  const lines = stdout.trim().split('\n').slice(1); // Skip header
  for (const line of lines) {
    if (!line.trim()) continue;
    // CSV format: "Id","WorkingSet64","CPU"
    const parts = line.split(',').map(s => s.replace(/"/g, '').trim());
    if (parts.length >= 3) {
      const pidStr = parts[0];
      const memoryStr = parts[1];
      const cpuStr = parts[2];

      if (memoryStr) {
        const memory = parseInt(memoryStr, 10);
        if (!isNaN(memory)) totalMemory += memory;
      }

      // Calculate CPU percentage using interval-based tracking
      if (pidStr && cpuStr) {
        const pid = parseInt(pidStr, 10);
        const cpuTime = parseFloat(cpuStr);

        if (!isNaN(pid) && !isNaN(cpuTime)) {
          const cached = cpuCache.get(pid);

          if (cached) {
            // Calculate percentage: (delta CPU time / delta wall time) * 100
            const timeDeltaMs = now - cached.time;
            const cpuDelta = cpuTime - cached.cpuTime;

            if (timeDeltaMs > 0 && cpuDelta > 0) {
              // CPU time is in seconds, convert to ms for comparison
              const cpuPercent = (cpuDelta * 1000 / timeDeltaMs) * 100;
              totalCpuPercent += cpuPercent;
            }
          }

          // Update cache
          cpuCache.set(pid, { time: now, cpuTime });
        }
      }
    }
  }

  console.log('Total memory:', totalMemory, 'Total CPU%:', totalCpuPercent);

  // Clean up cache for PIDs that are no longer in the tree
  for (const cachedPid of cpuCache.keys()) {
    if (!allPids.has(cachedPid)) {
      cpuCache.delete(cachedPid);
    }
  }

  return {
    cpuPercent: Math.round(totalCpuPercent * 10) / 10,
    memoryUsed: totalMemory,
  };
}

/**
 * Get process stats on Unix (macOS/Linux) using ps.
 */
async function getProcessStatsUnix(pids: readonly number[]): Promise<ProcessStats> {
  const pidList = pids.join(',');
  // Get %CPU and RSS (memory in KB)
  const { stdout } = await execAsync(
    `ps -p ${pidList} -o %cpu=,rss= 2>/dev/null || true`,
    { timeout: 5000 }
  );

  let totalMemory = 0;
  let totalCpu = 0;

  const lines = stdout.trim().split('\n');
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      const cpuStr = parts[0];
      const memKbStr = parts[1];
      if (cpuStr) {
        const cpu = parseFloat(cpuStr);
        if (!isNaN(cpu)) totalCpu += cpu;
      }
      if (memKbStr) {
        const memoryKb = parseInt(memKbStr, 10);
        if (!isNaN(memoryKb)) totalMemory += memoryKb * 1024; // Convert KB to bytes
      }
    }
  }

  return {
    cpuPercent: Math.round(totalCpu * 10) / 10,
    memoryUsed: totalMemory,
  };
}

/**
 * Calculate CPU usage percentage by sampling over a short interval.
 * Returns a value between 0 and 100.
 */
async function getCpuUsage(): Promise<number> {
  const cpus = os.cpus();

  // Get initial CPU times
  const startTimes = cpus.map(cpu => ({
    idle: cpu.times.idle,
    total: Object.values(cpu.times).reduce((acc, time) => acc + time, 0),
  }));

  // Wait 100ms for a sample
  await new Promise(resolve => setTimeout(resolve, 100));

  // Get end CPU times
  const endCpus = os.cpus();
  const endTimes = endCpus.map(cpu => ({
    idle: cpu.times.idle,
    total: Object.values(cpu.times).reduce((acc, time) => acc + time, 0),
  }));

  // Calculate average CPU usage across all cores
  let totalIdle = 0;
  let totalUsed = 0;

  for (let i = 0; i < cpus.length; i++) {
    const start = startTimes[i];
    const end = endTimes[i];
    if (!start || !end) continue;

    const idleDiff = end.idle - start.idle;
    const totalDiff = end.total - start.total;
    totalIdle += idleDiff;
    totalUsed += totalDiff;
  }

  const usagePercent = totalUsed > 0 ? ((totalUsed - totalIdle) / totalUsed) * 100 : 0;
  return Math.max(0, Math.min(100, usagePercent));
}
