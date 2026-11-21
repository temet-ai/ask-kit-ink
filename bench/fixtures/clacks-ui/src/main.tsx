import React from "react";
import { render } from "ink";
import { App } from "./app.js";

const options = { alternateScreen: true, exitOnCtrlC: false };

const instance = render(<App />, options);

process.on("SIGTERM", () => {
  instance.unmount();
  process.exit(0);
});
