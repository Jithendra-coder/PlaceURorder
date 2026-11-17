// Project showcase shown only on the Tasty Bug demo build (NEXT_PUBLIC_DEMO_ACCOUNT=true).
// The production build never renders it, so visitors to the real app see no demo content.

const REPOSITORY_URL = "https://github.com/Jithendra-coder/PlaceURorder";
const PRODUCTION_URL = "https://universal-kiosk-app.vercel.app";
const CI_URL = `${REPOSITORY_URL}/actions/workflows/quality.yml`;

const CAPABILITIES = [
  "Self-service kiosk with three layouts, dine-in and takeaway, and several checkout methods",
  "Counter POS with offline-resilient queueing",
  "Kitchen display system with a live order queue and alerts",
  "Secure device pairing and remote kiosk control",
  "Merchant menu, inventory, reports and growth recommendations",
];

export function DemoShowcase() {
  if (process.env.NEXT_PUBLIC_DEMO_ACCOUNT !== "true") return null;
  return (
    <section className="mt-demo-showcase" aria-labelledby="mt-demo-showcase-title">
      <p className="mt-demo-showcase__eyebrow">Project showcase</p>
      <h2 id="mt-demo-showcase-title">PlaceURorder</h2>
      <p className="mt-demo-showcase__summary">
        A restaurant ordering platform with self-service kiosks, counter POS, a kitchen display and merchant administration.
        Built end to end by Jithendra Muttum.
      </p>
      <ul className="mt-demo-showcase__list">
        {CAPABILITIES.map((item) => <li key={item}>{item}</li>)}
      </ul>
      <p className="mt-demo-showcase__stack">
        <strong>Built with</strong> Next.js 16, React 19, FastAPI, PostgreSQL, Vercel and Supabase.
      </p>
      <div className="mt-demo-showcase__links">
        <a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">Source code on GitHub</a>
        <a href={PRODUCTION_URL} target="_blank" rel="noopener noreferrer">Production app</a>
        <a href={CI_URL} target="_blank" rel="noopener noreferrer">CI checks</a>
      </div>
      <p className="mt-demo-showcase__note">The Tasty Bug data is fictional and lives in a separate demo database.</p>
    </section>
  );
}
