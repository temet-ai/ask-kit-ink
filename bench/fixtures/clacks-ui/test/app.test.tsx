import React from "react";
import { render } from "ink-testing-library";
import { expect, test } from "vitest";
import { App } from "../src/app.js";

test("lists the towers", () => {
  const { lastFrame } = render(<App />);
  expect(lastFrame()).toContain("Sto Lat");
});
