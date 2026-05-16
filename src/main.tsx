import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// @ts-ignore: CSS module import handled by bundler
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
