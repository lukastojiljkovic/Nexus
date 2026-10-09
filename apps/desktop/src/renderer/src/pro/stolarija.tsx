import { boardFoot } from "@nexus/core/pro/stolarija";
import { useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import { proNum, proParse, proUnit } from "./format.js";
import { ResultRow, ToolFailure, ToolFormula, ToolInput, ToolSection, ToolSelect } from "./shared.js";

/**
 * „Stolarija" — this toolkit's surfaces.
 *
 * **This file holds ONE tool, and that is the pack's honest size.** Woodworking
 * turned out to be the trade `zanat` had already built: the timber take-off, the
 * stair flight, the mitre, the shelf deflection, the shelf spacing and the
 * moisture movement all name this pack now and are drawn by `pro/zanat.tsx` and
 * `pro/gradnja.tsx`. The board foot is the one thing that was missing.
 *
 * All arithmetic is `@nexus/core/pro/stolarija.ts`'s; nothing here rounds or
 * compares, and the trade's own nominal thickness is what the user typed.
 */

export function BoardFootTool() {
  const s = strings.pro.stolarija["board-foot"];
  const [mode, setMode] = useState<"pieces" | "volume" | "boardFeet">("pieces");
  const [thicknessText, setThicknessText] = useState("");
  const [widthText, setWidthText] = useState("");
  const [lengthText, setLengthText] = useState("");
  const [piecesText, setPiecesText] = useState("");
  const [volumeText, setVolumeText] = useState("");
  const [boardFeetText, setBoardFeetText] = useState("");

  const result = boardFoot(
    mode === "pieces"
      ? {
          mode: "pieces",
          thicknessMm: proParse(thicknessText) ?? Number.NaN,
          widthMm: proParse(widthText) ?? Number.NaN,
          lengthMm: proParse(lengthText) ?? Number.NaN,
          pieces: proParse(piecesText) ?? 1,
        }
      : mode === "volume"
        ? { mode: "volume", volumeM3: proParse(volumeText) ?? Number.NaN }
        : { mode: "boardFeet", boardFeet: proParse(boardFeetText) ?? Number.NaN },
  );

  const typed =
    proParse(thicknessText) !== undefined ||
    proParse(volumeText) !== undefined ||
    proParse(boardFeetText) !== undefined;
  const errors: Readonly<Record<string, string>> = {
    mode: s.errorMode,
    thickness: s.errorThickness,
    width: s.errorWidth,
    length: s.errorLength,
    pieces: s.errorPieces,
    volume: s.errorVolume,
    boardFeet: s.errorBoardFeet,
  };
  const reason = result.ok ? undefined : result.reason;
  const failure =
    reason === undefined || !typed
      ? undefined
      : reason === "thickness"
        ? s.errorThickness
        : reason === "width"
          ? s.errorWidth
          : reason === "length"
            ? s.errorLength
            : reason === "pieces"
              ? s.errorPieces
              : reason === "volume"
                ? s.errorVolume
                : reason === "boardFeet"
                  ? s.errorBoardFeet
                  : errors[reason];

  return (
    <>
      <ToolSelect<"pieces" | "volume" | "boardFeet">
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "pieces", label: s.modePieces },
          { id: "volume", label: s.modeVolume },
          { id: "boardFeet", label: s.modeBoardFeet },
        ]}
      />
      {mode === "pieces" ? (
        <>
          <ToolInput label={s.thickness} hint={s.thicknessHint} value={thicknessText} onChange={setThicknessText} />
          <ToolInput label={s.width} hint={s.widthHint} value={widthText} onChange={setWidthText} />
          <ToolInput label={s.length} hint={s.lengthHint} value={lengthText} onChange={setLengthText} />
          <ToolInput label={s.pieces} value={piecesText} onChange={setPiecesText} />
        </>
      ) : mode === "volume" ? (
        <ToolInput label={s.volume} hint={s.volumeHint} value={volumeText} onChange={setVolumeText} />
      ) : (
        <ToolInput label={s.boardFeet} hint={s.boardFeetHint} value={boardFeetText} onChange={setBoardFeetText} />
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <>
          <ToolSection title={s.results}>
            <ResultRow label={s.resultPerPiece} value={proUnit(proNum(result.boardFeetPerPiece, 3), s.unitBdFt)} />
            <ResultRow label={s.resultBoardFeet} value={proUnit(proNum(result.boardFeet, 3), s.unitBdFt)} />
            <ResultRow label={s.resultM3} value={proUnit(proNum(result.volumeM3, 6), s.unitM3)} />
            <ResultRow label={s.resultFt3} value={proUnit(proNum(result.volumeFt3, 4), s.unitFt3)} />
          </ToolSection>
          <ToolFormula>{s.formula}</ToolFormula>
        </>
      )}
    </>
  );
}

/** Every surface this file holds, by tool id — held to the registrations by `proToolSurfaces.test.ts`. */
export const STOLARIJA_SURFACES: Readonly<Record<string, ComponentType>> = {
  "board-foot": BoardFootTool,
};
