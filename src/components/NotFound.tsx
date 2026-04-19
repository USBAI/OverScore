import { Link } from 'react-router-dom';
import { Button } from './ui/button';

export function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
      <div className="font-display text-7xl font-bold tracking-tight gradient-text">404</div>
      <p className="mt-3 text-muted-foreground">That page doesn't exist.</p>
      <Button asChild className="mt-6">
        <Link to="/matches">Back to matches</Link>
      </Button>
    </div>
  );
}
