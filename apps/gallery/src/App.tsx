import { useState } from "react";
import type { ReactNode } from "react";
import {
  Button,
  Card,
  CellMatrix,
  ChartFrame,
  ChartLegend,
  Checkbox,
  Chip,
  ColumnPlot,
  EmptyState,
  Icon,
  ICON_NAMES,
  LoadingState,
  PageHeader,
  ProportionBar,
  RadialCycle,
  SaveIndicator,
  SeriesPlot,
  SpanLanes,
  StarField,
  StatBand,
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

// CellMatrix demo — a small habit heatmap. `null` (weekend cells for
// "Trčanje") is NOT a measured zero: those days were never scheduled, so the
// component draws no cell there rather than a false "skipped" one.
const heatmapDays = ["po", "ut", "sr", "če", "pe", "su", "ne"] as const;
const heatmapHabits = ["Trčanje", "Čitanje", "Meditacija"] as const;
const heatmapLevels: (0 | 1 | 2 | 3 | null)[][] = [
  [3, 0, 3, 0, 3, null, null],
  [2, 3, 1, 3, 2, 3, 1],
  [1, 2, 3, 2, 3, 3, 3],
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
  const [segmented, setSegmented] = useState("Lista");
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

      {/* `.nx-segmented__option` is a FOURTH Button treatment and not a
          `variant`, so nothing in this gallery showed it — while thirteen
          surfaces in the app depend on it, and one of them had already drifted
          off it into a filled primary before the class existed. Both states are
          on screen here, in both themes, because the whole point of the recipe
          is that the selected one is typographic rather than filled. */}
      <Section title="Segmented (selection = aria-pressed)">
        <div className="gallery__row" role="group" aria-label="Prikaz">
          {["Lista", "Tabla", "Kalendar"].map((option) => (
            <Button
              key={option}
              size="sm"
              className="nx-segmented__option"
              aria-pressed={segmented === option}
              onClick={() => setSegmented(option)}
            >
              {option}
            </Button>
          ))}
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
          {/* With icons, because the rail always has them and the stylesheet
              devotes three rules to what a nav icon does — muted, accent on
              hover, accent when active. None of the three had ever been on
              screen here, so the one state that most needed reviewing by eye
              was the one the gallery could not show. `size={16}` is the rail's
              own. */}
          <NavItem href="#" active>
            <Icon name="dashboard" size={16} />
            Dashboard
          </NavItem>
          <NavItem href="#" badge={7}>
            <Icon name="tasks" size={16} />
            Zadaci
          </NavItem>
          <NavItem href="#">
            <Icon name="notes" size={16} />
            Beleške
          </NavItem>
          <NavItem href="#" badge={2}>
            <Icon name="calendar" size={16} />
            Kalendar
          </NavItem>
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

      {/* „How am I doing", above „what is on the list" — so the band belongs
          here, immediately before the row it summarises, and not down among
          the charts. Both shapes are on screen because they are a UNION in the
          type and a page picks exactly one: flat figures that share nothing,
          or groups that each say their unit once. The `note` is the one part
          worth reviewing by eye every time — it is where a figure admits to
          being a lower bound rather than a total. */}
      <Section title="StatBand (ravan niz figura)">
        <StatBand
          stats={[
            { label: "Ukupno", value: "84", note: "Bez obrisanih stavki." },
            { label: "Na vreme", value: "51", tone: "data" },
            { label: "Sa zakašnjenjem", value: "33", tone: "danger" },
            { label: "Najduže", value: "19", unit: "dana" },
          ]}
          aside={
            <SeriesPlot
              title="Fokus po danu"
              description="Fokus po danu: 353 minuta kroz sedam dana, najviše u petak."
              empty={null}
              x={{ domain: [0, 6] }}
              series={[
                {
                  key: "focus",
                  tone: "data",
                  shape: "line",
                  dots: true,
                  points: focusData.map((d, i) => ({ x: i, y: d.value })),
                },
              ]}
              width={320}
              height={96}
            />
          }
          caption="Poslednjih sedam dana; zadaci bez roka se ne broje ni u jednu kolonu."
        />
      </Section>

      {/* The grouped shape: the unit is said ONCE above the figures that share
          it, and the two flows sit a tier below the figure they moved — which
          is what `size: "flow"` is for and the only place the second tier can
          be judged, side by side with a `lead`. */}
      <Section title="StatBand (grupe — jedinica se kaže jednom)">
        <StatBand
          groups={[
            {
              label: "RSD",
              stats: [
                { label: "Stanje", value: "128.400", unit: "RSD" },
                { label: "Prihod", value: "92.000", size: "flow", tone: "data" },
                { label: "Rashod", value: "74.300", size: "flow", tone: "danger" },
              ],
            },
            {
              label: "EUR",
              stats: [
                { label: "Stanje", value: "1.240", unit: "EUR" },
                { label: "Prihod", value: "400", size: "flow", tone: "data" },
                { label: "Rashod", value: "260", size: "flow", tone: "danger" },
              ],
            },
          ]}
          caption="Tekući mesec, samo evidentirani računi."
        />
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

      {/* The whole drawn-data vocabulary, in the order a reader meets it: the
          frame every chart shares (empty state included — that is the part
          nobody ever sees otherwise), then each primitive, then the legend
          that explains a chart's tones without adding a fifth colour. */}
      <Section title="ChartFrame (prazno stanje)">
        <Card title="Fokus — ova nedelja">
          <ChartFrame
            title="Fokus po danu"
            description="Nema zabeleženih fokus sesija ove nedelje."
            viewBox={[320, 160]}
            empty={{ reason: "Nema zabeleženih fokus sesija ove nedelje." }}
          >
            {/* Never rendered — ChartFrame emits only the reason paragraph
                while `empty` is set. Present so the type (children required)
                is satisfied without pretending there is a real drawing. */}
            <circle cx={160} cy={80} r={3} aria-hidden="true" />
          </ChartFrame>
        </Card>
      </Section>

      <Section title="CellMatrix">
        <Card title="Navike — poslednja nedelja">
          <CellMatrix
            title="Navike po danu"
            description="Tri navike praćene sedam dana; „Trčanje“ se ne prati vikendom, „Meditacija“ ima niz od pet dana zaredom."
            empty={null}
            columns={heatmapDays}
            rows={heatmapHabits}
            cellAt={(row, col) => {
              const level = heatmapLevels[heatmapHabits.indexOf(row)]?.[heatmapDays.indexOf(col)];
              if (level == null) return null;
              return {
                tone: "accent",
                level,
                label: `${row}, ${col}: ${level > 0 ? "urađeno" : "preskočeno"}`,
              };
            }}
          />
        </Card>
      </Section>

      <Section title="ProportionBar">
        <Card title="Ishrana — makroi">
          <div className="gallery__stack">
            <ProportionBar
              label="Belančevine"
              value="128 od 150 g"
              segments={[{ key: "p", fraction: 128 / 150, tone: "accent", label: "128 od 150 g" }]}
              target={{ fraction: 1, label: "cilj" }}
              describedAs="Belančevine: 128 od 150 g, cilj još nije dostignut."
            />
            <ProportionBar
              label="Ugljeni hidrati"
              value="210 od 180 g"
              segments={[
                { key: "u", fraction: 180 / 210, tone: "accent", label: "180 od 210 g" },
                { key: "p", fraction: 30 / 210, tone: "danger", label: "30 g preko cilja" },
              ]}
              target={{ fraction: 180 / 210, label: "cilj" }}
              describedAs="Ugljeni hidrati: 210 od 180 g, prekoračeno za 30 g."
            />
            {/* `unmeasured`: no goal set — distinct from a goal of zero, so this
                must not draw as a full empty track pretending to be one. */}
            <ProportionBar
              label="Masti"
              segments={[]}
              unmeasured
              describedAs="Masti: cilj nije postavljen."
            />
          </div>
        </Card>
      </Section>

      <Section title="ColumnPlot">
        <div className="gallery__row">
          <Card title="baseline: zero — fokus po danu">
            <ColumnPlot
              title="Fokus po danu"
              description="Fokus po danu: 353 minuta kroz 7 dana, najviše u petak."
              caption="Jedan stubac je jedan dan."
              empty={null}
              slots={focusData.map((d) => ({ key: d.label, label: d.label }))}
              series={[{ key: "focus", tone: "accent", values: focusData.map((d) => d.value) }]}
              width={320}
            />
          </Card>
          <Card title="baseline: signed — neto kalorije">
            <ColumnPlot
              title="Neto kalorije po danu"
              description="Neto kalorije: suficit pet dana, deficit dva dana, najveći suficit u ponedeljak."
              caption="Iznad linije suficit, ispod deficit."
              empty={null}
              baseline="signed"
              slots={["po", "ut", "sr", "če", "pe", "su", "ne"].map((label) => ({ key: label, label }))}
              series={[
                { key: "kcal", tone: "accent", values: [420, 180, -150, 260, -300, 90, 310] },
              ]}
              width={320}
            />
          </Card>
        </div>
      </Section>

      <Section title="SeriesPlot">
        <div className="gallery__row">
          <Card title="shape: line — telesna težina">
            <SeriesPlot
              title="Telesna težina"
              description="Telesna težina: pad sa 82,4 na 79,5 kg za deset dana, bez merenja petog dana."
              caption="Praznina je dan bez merenja, ne interpolirana vrednost."
              empty={null}
              x={{ domain: [1, 10] }}
              series={[
                {
                  key: "weight",
                  tone: "accent",
                  shape: "line",
                  dots: true,
                  points: [
                    { x: 1, y: 82.4 },
                    { x: 2, y: 82.0 },
                    { x: 3, y: 81.6 },
                    { x: 4, y: 81.3 },
                    null,
                    { x: 6, y: 80.7 },
                    { x: 7, y: 80.4 },
                    { x: 8, y: 80.1 },
                    { x: 9, y: 79.8 },
                    { x: 10, y: 79.5 },
                  ],
                },
              ]}
              width={320}
            />
          </Card>
          <Card title="shape: area — unos vode">
            <SeriesPlot
              title="Unos vode"
              description="Unos vode: prosečno 2057 ml dnevno, najviše u subotu."
              caption="Sedam dana, u mililitrima."
              empty={null}
              x={{ domain: [0, 6] }}
              series={[
                {
                  key: "water",
                  tone: "data",
                  shape: "area",
                  points: [
                    { x: 0, y: 1800 },
                    { x: 1, y: 2100 },
                    { x: 2, y: 1600 },
                    { x: 3, y: 2400 },
                    { x: 4, y: 2000 },
                    { x: 5, y: 2600 },
                    { x: 6, y: 1900 },
                  ],
                },
              ]}
              width={320}
            />
          </Card>
        </div>
      </Section>

      <Section title="SpanLanes">
        <Card title="Avgust — obaveze">
          <SpanLanes
            title="Obaveze po danu"
            domain={[1, 31]}
            description="Ispitni rok traje od 5. do 20. avgusta sa usmenim 12. avgusta; odmor je otvoren od 22. avgusta i još traje."
            caption="Jedan dan je jedna jedinica."
            empty={null}
            rule={{ at: 15, label: "danas", tone: "neutral" }}
            width={320}
            lanes={[
              {
                key: "ispit",
                label: "Ispitni rok",
                tone: "accent",
                spans: [{ from: 5, to: 20, label: "Ispitni rok: 5–20. avgust" }],
                marks: [{ at: 12, kind: "tick", label: "Usmeni ispit, 12. avgust" }],
              },
              {
                key: "odmor",
                label: "Odmor",
                tone: "data",
                spans: [{ from: 22, to: "open", label: "Odmor od 22. avgusta, u toku" }],
                marks: [],
              },
            ]}
          />
        </Card>
      </Section>

      <Section title="RadialCycle">
        <Card title="Navika — nedeljni ritam">
          <RadialCycle
            title="Navika po danu u nedelji"
            description="Navika praćena radnim danima; najjača sreda i petak, vikend nije praćen."
            caption="Ponedeljak je prva pozicija."
            empty={null}
            period={{ kind: "week", weekStartsOn: 1 }}
            spokes={[
              { at: 0, value: 0.6, tone: "accent" },
              { at: 1, value: 1, tone: "accent" },
              { at: 2, value: 0.8, tone: "accent" },
              { at: 3, value: 0.4, tone: "accent" },
              { at: 4, value: 1, tone: "accent" },
            ]}
            marks={[{ at: 2, label: "danas", tone: "accent" }]}
            hand={{ at: 2 }}
            absent={[5, 6]}
            size={320}
          />
        </Card>
      </Section>

      <Section title="ChartLegend">
        <div className="gallery__row">
          <Card title="podrazumevano (stubac)">
            <ChartLegend
              items={[
                { label: "Uneto", tone: "accent", shape: "swatch" },
                { label: "Prosek", tone: "data", shape: "line" },
                { label: "Cilj", tone: "accent", shape: "dash" },
                { label: "Danas", tone: "neutral", shape: "tick" },
              ]}
            />
          </Card>
          <Card title="inline (red ispod kartice)">
            <ChartLegend
              inline
              items={[
                { label: "Uneto", tone: "accent", shape: "swatch" },
                { label: "Prekoračeno", tone: "danger", shape: "swatch" },
              ]}
            />
          </Card>
        </div>
      </Section>

      <Section title="PageHeader">
        <PageHeader
          title="Beleške"
          subtitle="Jedan naslov za ceo proizvod — stranica daje samo reči."
          actions={<Button variant="primary">Nova beleška</Button>}
        />
      </Section>

      <Section title="Ikone">
        {/* The whole set, at the size the rail draws it, and „whole" is now a
            fact rather than a promise: `ICON_NAMES` is read off the shape table
            in `@nexus/ui`, so an icon drawn tomorrow appears here without
            anybody remembering to add it. The hand-written list this replaced
            claimed the same thing and had been showing 27 of 91 for months.
            Not a library: shapes on a 24 grid, stroke only, one weight. */}
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

      {/* Noć's ground, and the only component in this gallery that renders
          differently per panel rather than merely being coloured differently:
          Dan has no sky, so `enabled` is false there and NOTHING is painted —
          not a faded sky, no canvas at all. Both states are worth having side
          by side, because „it is off in Dan" is a claim that is otherwise only
          checkable by launching the app.

          The host box is deliberately a fixed, NON-SCROLLING panel. That is the
          component's binding rule and not a gallery convenience: the app's
          scrolling panes paint their own opaque background, so a sky placed on
          one would scroll with the content, and the single CSS property that
          would pin it forces a main-thread repaint on every scroll frame. Sky
          goes on the sidebar, the lock screen and empty states — never behind
          a list. `density` is stars across the full 3840×2160 world box, not
          across this element, so the two panels below are the same sky at two
          densities rather than two different skies. */}
      <Section title="StarField (Noćina podloga — u Danu se ne crta)">
        <div className="gallery__row">
          <div className="gallery__sky">
            <StarField enabled={theme === "noc"} />
            <span>podrazumevana gustina</span>
          </div>
          <div className="gallery__sky">
            <StarField enabled={theme === "noc"} density={1600} />
            <span>density=1600</span>
          </div>
        </div>
      </Section>
    </div>
  );
}

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
