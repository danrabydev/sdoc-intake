import { useState } from "react";
import { createRoot } from "react-dom/client";
import { IntakeApp } from "@/components/sdoc/IntakeApp";
import "./styles.css";

function readLocation(): { file: string; uid: string } {
  const search = new URLSearchParams(window.location.search);
  return {
    file: search.get("file") ?? "",
    uid: search.get("uid") ?? "",
  };
}

function CliApp() {
  const [location, setLocation] = useState(readLocation);
  return (
    <IntakeApp
      initial={{ root: "", files: [], nodes: [], file: null }}
      file={location.file}
      uid={location.uid}
      onSelect={(file, uid) => {
        const next = new URLSearchParams(window.location.search);
        if (file) next.set("file", file);
        else next.delete("file");
        if (uid) next.set("uid", uid);
        else next.delete("uid");
        const query = next.toString();
        window.history.replaceState(null, "", query ? `/?${query}` : "/");
        setLocation({ file, uid });
      }}
    />
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(<CliApp />);
