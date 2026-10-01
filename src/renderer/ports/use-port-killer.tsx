import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { errorMessage } from '@/lib/errors';
import { useKillPort } from '@/lib/ports';

interface Target {
  pid: number;
  port: number;
}

interface Pending extends Target {
  processName: string | null;
  answer(confirmed: boolean): void;
}

/**
 * Frees a port: a NestBox script is stopped straight away; any other process is killed only after the
 * confirm dialog (rendered by `dialog`). `kill` resolves true when the port's owner was stopped or killed.
 */
export function usePortKiller(): { kill(target: Target): Promise<boolean>; dialog: React.ReactNode; isPending: boolean } {
  const mutation = useKillPort();
  const [pending, setPending] = useState<Pending | null>(null);

  const kill = async (target: Target): Promise<boolean> => {
    try {
      const first = await mutation.mutateAsync({ ...target, confirmed: false });
      if (first.result !== 'needs-confirm') return true;
      const confirmed = await new Promise<boolean>((answer) => setPending({ ...target, processName: first.processName, answer }));
      if (!confirmed) return false;
      await mutation.mutateAsync({ ...target, confirmed: true });
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    }
  };

  const close = (confirmed: boolean) => {
    pending?.answer(confirmed);
    setPending(null);
  };

  const dialog = (
    <AlertDialog open={pending !== null} onOpenChange={(open) => !open && close(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Kill {pending?.processName ?? 'the process'} (PID {pending?.pid}) listening on {pending?.port}?
          </AlertDialogTitle>
          <AlertDialogDescription>It wasn't started by NestBox. Unsaved work in it is lost.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction className="bg-err text-fg hover:bg-err/90" onClick={() => close(true)}>
            Kill
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { kill, dialog, isPending: mutation.isPending };
}
