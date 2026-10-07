import * as os from 'node:os';
import type { SystemStats } from '@shared/system-stats';

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
 * Calculate CPU usage percentage by sampling over a short interval.
 * Returns a value between 0 and 100.
 */
async function getCpuUsage(): Promise<number> {
  const cpus = os.cpus();

  // Get start CPU times
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
