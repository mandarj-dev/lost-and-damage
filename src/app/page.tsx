import { ApiLogin } from "@/components/ApiLogin";

export default function Home() {
  return (
    <div className="page" style={{ maxWidth: 640, paddingTop: 56 }}>
      <div className="crumbs">InstaLogix</div>
      <h1 className="page-title" style={{ marginBottom: 6 }}>Lost &amp; Damage Disputes</h1>
      <div className="card card-pad" style={{ marginTop: 20 }}>
        <h2 style={{ marginBottom: 6 }}>Dev sign-in (live backend)</h2>
        <p className="note-sm" style={{ marginTop: 0, marginBottom: 16 }}>Paste a bearer token for each role you want to test, then continue as that role. Switch roles any time from the top bar.</p>
        <ApiLogin />
      </div>
    </div>
  );
}
