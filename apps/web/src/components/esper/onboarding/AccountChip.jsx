import { useEffect, useRef, useState } from "react";
import { deleteAccount, GOOGLE_SIGN_IN_URL, signOut } from "../legacy-api.js";

/** Top-left account button over the planner: who is signed in, and the way out. */
export default function AccountChip({ me }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (event) => {
      if (event.key === "Escape" || (event.type === "pointerdown" && !ref.current?.contains(event.target))) {
        setOpen(false);
        setConfirming(false);
      }
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
    };
  }, [open]);

  if (!me?.user) {
    if (!me?.google?.available) return null;
    return (
      <a className="acct-chip" href={GOOGLE_SIGN_IN_URL}>
        Sign in with Google
      </a>
    );
  }

  const { name, email, picture } = me.user;
  async function run(action) {
    setError("");
    try {
      await action();
      window.location.assign("/");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="acct" ref={ref}>
      <button type="button" className="acct-chip" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {picture ? <img src={picture} alt="" referrerPolicy="no-referrer" /> : <span className="acct-initial">{(name || email || "?")[0]}</span>}
        {name || email}
      </button>
      {open ? (
        <div className="acct-menu" role="menu">
          <p className="acct-email">{email}</p>
          <a role="menuitem" href="/?onboarding">Redo setup</a>
          <button role="menuitem" type="button" onClick={() => run(signOut)}>Sign out</button>
          {confirming ? (
            <div className="acct-confirm">
              <p>Delete your ESPER account and disconnect Google? This cannot be undone.</p>
              <button type="button" className="acct-danger" onClick={() => run(deleteAccount)}>Delete account</button>
              <button type="button" onClick={() => setConfirming(false)}>Cancel</button>
            </div>
          ) : (
            <button role="menuitem" type="button" className="acct-quiet" onClick={() => setConfirming(true)}>Delete account…</button>
          )}
          {error ? <p className="acct-error" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
