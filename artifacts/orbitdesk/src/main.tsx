import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// After a deploy, an open tab may ask for code chunks that no longer exist.
// Reload once to pick up the new version instead of showing a blank page.
window.addEventListener("vite:preloadError", (event) => {
  const key = "orbit-reloaded-at";
  const last = Number(sessionStorage.getItem(key) || 0);
  if (Date.now() - last > 60_000) {
    sessionStorage.setItem(key, String(Date.now()));
    event.preventDefault();
    window.location.reload();
  }
});

createRoot(document.getElementById("root")!).render(<App />);
