import { FolderPlus } from 'lucide-react';
import { NestboxMark } from '@/components/NestboxMark';
import { Button } from '@/components/ui/button';
import { useAddProject } from '@/lib/queries';

export function EmptyState() {
  const addProject = useAddProject();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="flex items-center gap-3">
        <NestboxMark className="size-12" />
        <span className="text-3xl font-bold tracking-tight text-fg">NestBox</span>
      </div>
      <div>
        <h1 className="text-base font-semibold text-fg">No projects yet</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Add a project folder to see its scripts, env files and tools in one place.
        </p>
      </div>
      <Button onClick={() => addProject.mutate()} disabled={addProject.isPending}>
        <FolderPlus />
        Add project
      </Button>
    </div>
  );
}
