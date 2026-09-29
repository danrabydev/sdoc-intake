import { createFileRoute } from "@tanstack/react-router";
import { IntakeApp } from "@/components/sdoc/IntakeApp";
import { loadIntake } from "@/lib/sdoc/bootstrap";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => ({
    file: typeof search.file === "string" ? search.file : "",
    uid: typeof search.uid === "string" ? search.uid : "",
  }),
  loaderDeps: ({ search }) => ({ file: search.file }),
  loader: ({ deps }) => loadIntake({ data: { file: deps.file } }),
  component: Home,
});

function Home() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <IntakeApp
      initial={data}
      file={search.file}
      uid={search.uid}
      onSelect={(nextFile, nextUid) => {
        void navigate({ to: "/", search: { file: nextFile, uid: nextUid }, replace: true });
      }}
    />
  );
}
