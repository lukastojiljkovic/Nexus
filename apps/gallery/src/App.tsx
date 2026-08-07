import { useState } from "react";
import type { ReactNode } from "react";
import {
  BarChart,
  Button,
  Card,
  Checkbox,
  Chip,
  EmptyState,
  Icon,
  LoadingState,
  PageHeader,
  SaveIndicator,
  CardsView,
  KanbanCard,
  KanbanColumn,
  KanbanView,
  ListRow,
  ListView,
  NavItem,
  Select,
  TextField,
} from "@nexus/ui";
import type {
  CardsViewConfig,
  CollectionSchema,
  KanbanViewConfig,
  ListViewConfig,
} from "@nexus/core";
import type { IconName } from "@nexus/ui";
import type { ThemeName } from "@nexus/tokens";

const focusData = [
  { label: "po", value: 45 },
  { label: "ut", value: 70 },
  { label: "sr", value: 8 },
  { label: "če", value: 55 },
  { label: "pe", value: 85 },
  { label: "su", value: 60 },
  { label: "ne", value: 30 },
];

type StudijskiZadatak = {
  id: string;
  naslov: string;
  predmet: string;
  rok?: string;
  status?: string | null;
};

const zadaciSchema: CollectionSchema = {
  fields: [
    { key: "naslov", type: "text", titleKey: "task.title" },
    { key: "predmet", type: "text", titleKey: "task.subject" },
    { key: "rok", type: "date", titleKey: "task.due" },
    {
      key: "status",
      type: "select",
      titleKey: "task.status",
      options: ["Za učenje", "U toku", "Naučeno"],
    },
  ],
};

const pocetniZadaci: StudijskiZadatak[] = [
  { id: "z1", naslov: "Grupe — 2. poglavlje", predmet: "Algebra", rok: "2026-07-09", status: "Za učenje" },
  { id: "z2", naslov: "Sopstvene vrednosti — zadaci", predmet: "Algebra", rok: "2026-07-14", status: "U toku" },
  { id: "z3", naslov: "Homomorfizmi — teorija", predmet: "Algebra", status: "Za učenje" },
  { id: "z4", naslov: "Generativne funkcije", predmet: "Kombinatorika", rok: "2026-07-15", status: "Za učenje" },
  { id: "z5", naslov: "Princip uključenja–isključenja", predmet: "Kombinatorika", rok: "2026-07-10", status: "U toku" },
  { id: "z6", naslov: "Rekurentne relacije", predmet: "Kombinatorika", rok: "2026-07-18" },
];

const listaConfig: ListViewConfig = {
  type: "list",
  sort: { field: "rok", direction: "asc" },
  filters: [{ field: "predmet", equals: "Algebra" }],
};

const tablaConfig: KanbanViewConfig = {
  type: "kanban",
  groupBy: "status",
  sort: { field: "rok", direction: "asc" },
};

const karticeConfig: CardsViewConfig = {
  type: "cards",
  sort: { field: "naslov", direction: "asc" },
};

const fmtRok = (rok: string) => `${rok.slice(8, 10)}.${rok.slice(5, 7)}.`;

/**
 * One dataset, three engine views: the list is filtered + sorted, the kanban is
 * grouped by status, the cards grid is the same pipeline laid out as a grid.
 * Dragging a card applies the engine's patch to local state, so the board, the
 * grid and the list row chips update together.
 */
function ViewsEngineDemo() {
  const [zadaci, setZadaci] = useState(pocetniZadaci);
  return (
    <>
      <Section title="ListView (views engine — filter + sort)">
        <Card title="Algebra — obaveze">
          <div className="gallery__view-config">
            <Chip variant="data">predmet = Algebra</Chip>
            <Chip variant="accent">sort: rok ↑</Chip>
          </div>
          <ListView
            items={zadaci}
            schema={zadaciSchema}
            config={listaConfig}
            itemKey={(z) => z.id}
            renderItem={(z) => (
              <ListRow
                leading={<Checkbox />}
                trailing={
                  <span className="gallery__chips">
                    {z.status != null && <Chip variant="data">{z.status}</Chip>}
                    {z.rok ? (
                      <Chip variant="accent">{fmtRok(z.rok)}</Chip>
                    ) : (
                      <Chip>bez roka</Chip>
                    )}
                  </span>
                }
              >
                {z.naslov}
              </ListRow>
            )}
          />
        </Card>
      </Section>

      <Section title="KanbanView (views engine — prevuci karticu)">
        <Card title="Sve obaveze — po statusu">
          <KanbanView
            items={zadaci}
            schema={zadaciSchema}
            config={tablaConfig}
            ungroupedTitle="Bez statusa"
            itemKey={(z) => z.id}
            renderCard={(z) => (
              <KanbanCard tag={z.rok ? `plan: ${fmtRok(z.rok)}` : z.predmet}>
                {z.naslov}
              </KanbanCard>
            )}
            onMove={(zadatak, patch) =>
              setZadaci((prev) =>
                prev.map((z) => (z.id === zadatak.id ? { ...z, ...patch } : z)),
              )
            }
          />
        </Card>
      </Section>

      <Section title="CardsView (views engine — ista lista kao mreža)">
        <Card title="Sve obaveze — kartice">
          <div className="gallery__view-config">
            <Chip variant="accent">sort: naslov ↑</Chip>
          </div>
          <CardsView
            items={zadaci}
            schema={zadaciSchema}
            config={karticeConfig}
            itemKey={(z) => z.id}
            renderItem={(z) => (
              <>
                <Checkbox>{z.naslov}</Checkbox>
                <span className="gallery__chips">
                  <Chip variant="data">{z.predmet}</Chip>
                  {z.rok ? <Chip variant="accent">{fmtRok(z.rok)}</Chip> : <Chip>bez roka</Chip>}
                </span>
              </>
            )}
          />
        </Card>
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="gallery__section">
      <div className="gallery__section-title">{title}</div>
      {children}
    </section>
  );
}

function ThemePanel({ theme, label }: { theme: ThemeName; label: string }) {
  return (
    <div className="gallery__panel nx-app" data-theme={theme}>
      <div className="gallery__panel-title">{label}</div>

      <Section title="Button">
        <div className="gallery__row">
          <Button variant="primary">Nova beleška</Button>
          <Button>Otkaži</Button>
          <Button variant="danger">Obriši</Button>
          <Button variant="primary" size="sm">Sačuvaj</Button>
          <Button size="sm" disabled>Nedostupno</Button>
        </div>
      </Section>

      <Section title="Checkbox">
        <div className="gallery__stack">
          <Checkbox done defaultChecked>Pregled: sopstvene vrednosti</Checkbox>
          <Checkbox>Algebra — grupe, 2. poglavlje</Checkbox>
          <Checkbox>Produžiti registraciju auta</Checkbox>
        </div>
      </Section>

      <Section title="Chip">
        <div className="gallery__row">
          <Chip>rok 30 dana</Chip>
          <Chip variant="data">review</Chip>
          <Chip variant="accent">10:00</Chip>
          <Chip variant="danger">overdue</Chip>
        </div>
      </Section>

      <Section title="TextField">
        <div className="gallery__form">
          <TextField label="Naziv zadatka" placeholder="npr. Kombinatorika — 12 kartica" />
          <TextField label="Rok" defaultValue="12.07." />
          <TextField placeholder="Pretraži…  (Ctrl+K)" aria-label="Pretraga" />
        </div>
      </Section>

      {/* A select CANNOT ship unlabelled here: `label` is required and rendered,
          so the visible name and the accessible name are the same string. Both
          layouts are labelled — stacked for a form, inline for a controls row. */}
      <Section title="Select (oznaka je obavezna)">
        <div className="gallery__form">
          <Select label="Kategorija" defaultValue="mahunarke">
            <option value="povrce">Povrće</option>
            <option value="mahunarke">Mahunarke</option>
            <option value="meso">Meso</option>
          </Select>
          <Select label="Redosled" layout="inline" defaultValue="rok">
            <option value="rucno">Ručno</option>
            <option value="rok">Rok ↑</option>
            <option value="prioritet">Prioritet ↓</option>
          </Select>
          <Select label="Status" layout="inline" disabled defaultValue="sve">
            <option value="sve">Svi</option>
          </Select>
        </div>
      </Section>

      <Section title="Navigation (selection = tipografija + ✦)">
        <nav className="gallery__nav-demo">
          <NavItem href="#" active>Dashboard</NavItem>
          <NavItem href="#" badge={7}>Zadaci</NavItem>
          <NavItem href="#">Beleške</NavItem>
          <NavItem href="#" badge={2}>Kalendar</NavItem>
        </nav>
      </Section>

      <Section title="Card / widget">
        <Card title="Odbrojavanja — ispiti">
          <div className="gallery__stack">
            <Checkbox>Algebra — za 41 dan</Checkbox>
            <Checkbox>Linearna algebra i AG — za 48 dana</Checkbox>
          </div>
        </Card>
      </Section>

      <Section title="ListRow (task / agenda red)">
        <Card title="Danas">
          <ListRow leading={<Checkbox defaultChecked />} muted>
            Pregled: sopstvene vrednosti
          </ListRow>
          <ListRow
            leading={<Checkbox />}
            trailing={<Chip variant="accent">10:00</Chip>}
          >
            Algebra — grupe, 2. poglavlje
          </ListRow>
          <ListRow
            leading={<Checkbox />}
            trailing={<Chip variant="data">review</Chip>}
          >
            Kombinatorika — 12 kartica
          </ListRow>
          <ListRow leading={<Checkbox />} trailing={<Chip>rok 30 dana</Chip>}>
            Produžiti registraciju auta
          </ListRow>
        </Card>
      </Section>

      <Section title="Kanban">
        <Card title="Kombinatorika — teme">
          <div className="gallery__kanban">
            <KanbanColumn title="Za učenje" count={3}>
              <KanbanCard tag="plan: 12.07.">Teorija grafova — bojenja</KanbanCard>
              <KanbanCard tag="plan: 15.07.">Generativne funkcije</KanbanCard>
              <KanbanCard tag="plan: 18.07.">Rekurentne relacije</KanbanCard>
            </KanbanColumn>
            <KanbanColumn title="U toku" count={1}>
              <KanbanCard tag="8 kartica · 2 zadatka">
                Princip uključenja–isključenja
              </KanbanCard>
            </KanbanColumn>
            <KanbanColumn title="Naučeno" count={2}>
              <KanbanCard>Permutacije i kombinacije</KanbanCard>
              <KanbanCard>Dirihleov princip</KanbanCard>
            </KanbanColumn>
          </div>
        </Card>
      </Section>

      <ViewsEngineDemo />

      <Section title="BarChart">
        <Card title="Fokus — poslednjih 7 dana">
          <BarChart data={focusData} />
        </Card>
      </Section>

      <Section title="PageHeader">
        <PageHeader
          title="Beleške"
          subtitle="Jedan naslov za ceo proizvod — stranica daje samo reči."
          actions={<Button variant="primary">Nova beleška</Button>}
        />
      </Section>

      <Section title="Ikone">
        {/* The whole set, at the size the rail draws it. Not a library: 27
            shapes on a 24 grid, stroke only, one weight. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
          {ICON_NAMES.map((name) => (
            <span key={name} title={name} style={{ display: "grid", placeItems: "center" }}>
              <Icon name={name} size={20} />
            </span>
          ))}
        </div>
      </Section>

      <Section title="SaveIndicator">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SaveIndicator status="saving" savingLabel="Čuvanje…" savedLabel="" />
          <SaveIndicator status="saved" savingLabel="" savedLabel="Sačuvano u 14:32" />
          <SaveIndicator
            status="error"
            savingLabel=""
            savedLabel=""
            errorLabel="Crtež nije sačuvan. Poslednje izmene su samo na ekranu."
          />
        </div>
      </Section>

      <Section title="LoadingState">
        <Card>
          <LoadingState label="Učitavanje…" rows={4} />
        </Card>
      </Section>

      {/* Two shapes, one component. `page` is the whole surface being empty and
          is allowed the space; `inline` is ONE list inside a populated page —
          a card that said the same thing in 18px centred type with sixty-four
          pixels of air would be shouting about the one thing that did not
          happen. */}
      <Section title="EmptyState (dva oblika)">
        <Card>
          <EmptyState
            title="Još nema beleški"
            description="Zabeleži prvu misao — ideje, citate ili plan za ispit. Sve ostaje na tvom uređaju."
            action={<Button variant="primary">Nova beleška</Button>}
          />
        </Card>
        <Card>
          <EmptyState variant="inline" title="Danas još nema upisanih obroka" />
        </Card>
      </Section>
    </div>
  );
}

/** Every icon the set ships, in declaration order — the gallery's whole job is to show all of them, not a chosen few. */
const ICON_NAMES = [
  "dashboard", "tasks", "calendar", "notes", "study", "focus", "files", "finance",
  "habits", "fitness", "canvas", "tools", "priv", "settings", "search", "plus",
  "check", "pencil", "trash", "close", "chevronDown", "chevronRight", "bell",
  "filter", "export", "import", "undo",
] as const satisfies readonly IconName[];

export function App() {
  return (
    <div className="gallery nx-app">
      <header className="gallery__header">
        <h1>Nexus — Component Gallery</h1>
        <p>
          Direction D v2 (Dan/Noć) · izvor stilova: @nexus/tokens · sirove hex
          vrednosti su zabranjene van tokens paketa
        </p>
      </header>
      <div className="gallery__themes">
        <ThemePanel theme="noc" label="Noć — vesper" />
        <ThemePanel theme="dan" label="Dan — papir" />
      </div>
    </div>
  );
}
