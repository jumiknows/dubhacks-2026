import { GestureProvider } from "conjure-gestures";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
const GestureLab = React.lazy(() => import('./gesture-lab/GestureLab.jsx'));
const isGestureLab = window.location.pathname.replace(/\/+$/, '') === '/gesture-lab';

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <GestureProvider poseDebug={!isGestureLab}>
      {isGestureLab
        ? <React.Suspense fallback={<p>Loading gesture lab…</p>}><GestureLab /></React.Suspense>
        : <><App /><a className="gesture-lab-launch" href="/gesture-lab" data-gesture-ignore>Test gestures · spawn test objects</a></>}
    </GestureProvider>
  </React.StrictMode>
);
