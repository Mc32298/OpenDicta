import { Suspense, lazy, useEffect } from "react";
import VoiceBar from "./windows/VoiceBar";

const Settings = lazy(() => import("./windows/Settings"));
const Onboarding = lazy(() => import("./windows/Onboarding"));
const EmptyStates = lazy(() => import("./windows/EmptyStates"));

let prefetched = false;
function prefetchWindows() {
  if (prefetched) return;
  prefetched = true;
  void import("./windows/Settings");
  void import("./windows/Onboarding");
  void import("./windows/EmptyStates");
}

function getWindowName(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("window") ?? "voicebar";
}

export default function App() {
  const windowName = getWindowName();

  useEffect(() => {
    if (windowName !== "voicebar") return;
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      (window as Window & { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback(() => {
        prefetchWindows();
      });
    } else {
      const id = globalThis.setTimeout(prefetchWindows, 250);
      return () => globalThis.clearTimeout(id);
    }
  }, [windowName]);

  if (windowName === "settings") {
    return (
      <Suspense fallback={null}>
        <Settings />
      </Suspense>
    );
  }
  if (windowName === "onboarding") {
    return (
      <Suspense fallback={null}>
        <Onboarding />
      </Suspense>
    );
  }
  if (windowName === "empty") {
    return (
      <Suspense fallback={null}>
        <EmptyStates />
      </Suspense>
    );
  }

  return <VoiceBar />;
}
