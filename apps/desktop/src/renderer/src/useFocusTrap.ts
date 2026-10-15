/**
 * The renderer's focus trap is the one in `@nexus/ui`: a dialog that needs it
 * imports it from here only because the renderer's dialogs predate the shared
 * component, and the two copies had to be read side by side to stay the same.
 * The implementation lives in one place now.
 */
export { useFocusTrap, type UseFocusTrapOptions } from "@nexus/ui";
