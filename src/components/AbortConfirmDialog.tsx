import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

interface Props {
  open: boolean;
  onStay: () => void;
  onLeave: () => void;
}

export function AbortConfirmDialog({ open, onStay, onLeave }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onStay()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Analysis in progress</DialogTitle>
          <DialogDescription>
            The AI is still running. Leaving this page now will cancel the analysis before it finishes.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onStay}>
            Stay
          </Button>
          <Button variant="destructive" onClick={onLeave}>
            Stop and leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
