import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <main className="status-page">
      <h1>Page not found</h1>
      <p>The requested page does not exist.</p>
      <Link to="/">Return to assigned fields</Link>
    </main>
  );
}
