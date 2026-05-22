import { Suspense, lazy, useEffect } from "react";
import VoiceBar from "./windows/VoiceBar";
import { ToastProvider } from "./ui/toast";
import { maybeAutoCheckForUpdates } from "./lib/updater";

const windowName = new URLSearchParams(window.location.search).get("window") ?? "voicebar";

// Kick off the relevant module import at module-evaluation time — before React
// mounts. Vite deduplicates these with the lazy() calls below (same promise),
// so by the time Suspense checks, the module is already resolved and the
// fallback={null} transparent-window period is eliminated.
if (windowName === "settings")    void import("./shell/AppShell");
else if (windowName === "onboarding") void import("./windows/Onboarding");
else if (windowName === "empty")  void import("./windows/EmptyStates");
else if (windowName === "quickswitch") void import("./windows/QuickSwitch");

const AppShell = lazy(() => import("./shell/AppShell"));
const Onboarding = lazy(() => import("./windows/Onboarding"));
const EmptyStates = lazy(() => import("./windows/EmptyStates"));
const QuickSwitch = lazy(() => import("./windows/QuickSwitch"));

let prefetched = false;
function prefetchWindows() {
  if (prefetched) return;
  prefetched = true;
  void import("./shell/AppShell");
  void import("./windows/Onboarding");
  void import("./windows/EmptyStates");
}

export default function App() {
  useEffect(() => {
    if (windowName !== "voicebar") return;
    if ("requestIdleCallback" in window) {
      (window as Window & { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback(prefetchWindows);
    } else {
      const id = globalThis.setTimeout(prefetchWindows, 250);
      return () => globalThis.clearTimeout(id);
    }
  }, []);

  useEffect(() => {
    if (windowName !== "voicebar") return;
    void maybeAutoCheckForUpdates();
  }, []);

  if (windowName === "settings") {
    return (
      <ToastProvider>
        <Suspense fallback={null}><AppShell /></Suspense>
      </ToastProvider>
    );
  }
  if (windowName === "onboarding") return <Suspense fallback={null}><Onboarding /></Suspense>;
  if (windowName === "empty")      return <Suspense fallback={null}><EmptyStates /></Suspense>;
  if (windowName === "quickswitch") return <Suspense fallback={null}><QuickSwitch /></Suspense>;
  return <VoiceBar />;
}
