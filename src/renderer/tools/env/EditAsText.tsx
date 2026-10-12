import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type TextFile = { name: string; readOnly: boolean };

/** Opens a file in the raw editor: the only one at once, otherwise picked from a menu. */
export function EditAsText({
  files,
  title = 'Edit a whole env file as plain text',
  onPick,
}: {
  files: readonly TextFile[];
  title?: string;
  onPick(file: TextFile): void;
}) {
  const button = (props: { onClick?: () => void }) => (
    <Button variant="ghost" size="sm" title={title} {...props}>
      <FileText />
      Edit as text
    </Button>
  );
  const [only] = files;
  if (only === undefined) return null;
  if (files.length === 1) return button({ onClick: () => onPick(only) });
  return (
    // modal={false}: opening the editor from a menu item must not leave pointer-events locked.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>{button({})}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {files.map((f) => (
          <DropdownMenuItem key={f.name} className="font-mono text-xs" onSelect={() => onPick(f)}>
            {f.readOnly ? `${f.name} (view only)` : f.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
