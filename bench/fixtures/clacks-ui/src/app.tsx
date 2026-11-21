import React, { useState } from "react";
import { Box, Static, Text, useInput } from "ink";

export function App() {
  const [towers, setTowers] = useState<string[]>(["Sto Lat", "Quirm"]);
  useInput((input, key) => {
    if (key.escape) setTowers([]);
    if (input === "a") setTowers((t) => [...t, `Tower ${t.length + 1}`]);
  });
  console.log("rendering", towers.length);
  return (
    <Box flexDirection="column">
      <Static items={["clacks relay started"]}>{(line) => <Text key={line}>{line}</Text>}</Static>
      {towers.map((t) => (
        <Box key={t}>
          <Text color="green">{t}</Text>
          <Text> ready</Text>
        </Box>
      ))}
    </Box>
  );
}
