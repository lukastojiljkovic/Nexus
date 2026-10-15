/**
 * The periodic table of the elements: 118 rows, one per element.
 *
 * **Where the data comes from.** Generated from PubChem's periodic-table dataset,
 * `https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/JSON`, fetched on
 * 2026-10-15. Number, symbol, English name and mass are that dataset's values as
 * published (lithium's mass is the dataset's `7.0`); the block category is the
 * dataset's `GroupBlock` in lower-case kebab form.
 *
 * **Group and period are derived, not copied.** The dataset carries no position,
 * so each element's period is the row of the standard 18-column table it falls in
 * (2, 8, 8, 18, 18, 32, 32 elements per period), and its group is its place in
 * that row. The lanthanides and actinides (57–71, 89–103) have no group in this
 * layout and are `null`.
 *
 * **Serbian element names are not in this file.** The reference shows the symbol
 * and the English name in both languages, because no Serbian name list was
 * sourced for this table; a name is never typed in from memory.
 */

export type ElementCategory =
  | "alkali-metal"
  | "alkaline-earth-metal"
  | "transition-metal"
  | "post-transition-metal"
  | "metalloid"
  | "nonmetal"
  | "halogen"
  | "noble-gas"
  | "lanthanide"
  | "actinide";

export interface Element {
  /** The atomic number, 1–118. */
  readonly number: number;
  readonly symbol: string;
  /** The English name, as the dataset spells it. */
  readonly name: string;
  /** The atomic mass the dataset publishes, in unified atomic mass units. */
  readonly mass: number;
  /** 1–18, or `null` for the lanthanides and actinides. */
  readonly group: number | null;
  /** 1–7. */
  readonly period: number;
  readonly category: ElementCategory;
}

export const ELEMENTS: readonly Element[] = [
  { number: 1, symbol: "H", name: "Hydrogen", mass: 1.008, group: 1, period: 1, category: "nonmetal" },
  { number: 2, symbol: "He", name: "Helium", mass: 4.0026, group: 18, period: 1, category: "noble-gas" },
  { number: 3, symbol: "Li", name: "Lithium", mass: 7, group: 1, period: 2, category: "alkali-metal" },
  { number: 4, symbol: "Be", name: "Beryllium", mass: 9.012183, group: 2, period: 2, category: "alkaline-earth-metal" },
  { number: 5, symbol: "B", name: "Boron", mass: 10.81, group: 13, period: 2, category: "metalloid" },
  { number: 6, symbol: "C", name: "Carbon", mass: 12.011, group: 14, period: 2, category: "nonmetal" },
  { number: 7, symbol: "N", name: "Nitrogen", mass: 14.007, group: 15, period: 2, category: "nonmetal" },
  { number: 8, symbol: "O", name: "Oxygen", mass: 15.999, group: 16, period: 2, category: "nonmetal" },
  { number: 9, symbol: "F", name: "Fluorine", mass: 18.99840316, group: 17, period: 2, category: "halogen" },
  { number: 10, symbol: "Ne", name: "Neon", mass: 20.18, group: 18, period: 2, category: "noble-gas" },
  { number: 11, symbol: "Na", name: "Sodium", mass: 22.9897693, group: 1, period: 3, category: "alkali-metal" },
  { number: 12, symbol: "Mg", name: "Magnesium", mass: 24.305, group: 2, period: 3, category: "alkaline-earth-metal" },
  { number: 13, symbol: "Al", name: "Aluminum", mass: 26.981538, group: 13, period: 3, category: "post-transition-metal" },
  { number: 14, symbol: "Si", name: "Silicon", mass: 28.085, group: 14, period: 3, category: "metalloid" },
  { number: 15, symbol: "P", name: "Phosphorus", mass: 30.973762, group: 15, period: 3, category: "nonmetal" },
  { number: 16, symbol: "S", name: "Sulfur", mass: 32.07, group: 16, period: 3, category: "nonmetal" },
  { number: 17, symbol: "Cl", name: "Chlorine", mass: 35.45, group: 17, period: 3, category: "halogen" },
  { number: 18, symbol: "Ar", name: "Argon", mass: 39.9, group: 18, period: 3, category: "noble-gas" },
  { number: 19, symbol: "K", name: "Potassium", mass: 39.0983, group: 1, period: 4, category: "alkali-metal" },
  { number: 20, symbol: "Ca", name: "Calcium", mass: 40.08, group: 2, period: 4, category: "alkaline-earth-metal" },
  { number: 21, symbol: "Sc", name: "Scandium", mass: 44.95591, group: 3, period: 4, category: "transition-metal" },
  { number: 22, symbol: "Ti", name: "Titanium", mass: 47.867, group: 4, period: 4, category: "transition-metal" },
  { number: 23, symbol: "V", name: "Vanadium", mass: 50.9415, group: 5, period: 4, category: "transition-metal" },
  { number: 24, symbol: "Cr", name: "Chromium", mass: 51.996, group: 6, period: 4, category: "transition-metal" },
  { number: 25, symbol: "Mn", name: "Manganese", mass: 54.93804, group: 7, period: 4, category: "transition-metal" },
  { number: 26, symbol: "Fe", name: "Iron", mass: 55.84, group: 8, period: 4, category: "transition-metal" },
  { number: 27, symbol: "Co", name: "Cobalt", mass: 58.93319, group: 9, period: 4, category: "transition-metal" },
  { number: 28, symbol: "Ni", name: "Nickel", mass: 58.693, group: 10, period: 4, category: "transition-metal" },
  { number: 29, symbol: "Cu", name: "Copper", mass: 63.55, group: 11, period: 4, category: "transition-metal" },
  { number: 30, symbol: "Zn", name: "Zinc", mass: 65.4, group: 12, period: 4, category: "transition-metal" },
  { number: 31, symbol: "Ga", name: "Gallium", mass: 69.723, group: 13, period: 4, category: "post-transition-metal" },
  { number: 32, symbol: "Ge", name: "Germanium", mass: 72.63, group: 14, period: 4, category: "metalloid" },
  { number: 33, symbol: "As", name: "Arsenic", mass: 74.92159, group: 15, period: 4, category: "metalloid" },
  { number: 34, symbol: "Se", name: "Selenium", mass: 78.97, group: 16, period: 4, category: "nonmetal" },
  { number: 35, symbol: "Br", name: "Bromine", mass: 79.9, group: 17, period: 4, category: "halogen" },
  { number: 36, symbol: "Kr", name: "Krypton", mass: 83.8, group: 18, period: 4, category: "noble-gas" },
  { number: 37, symbol: "Rb", name: "Rubidium", mass: 85.468, group: 1, period: 5, category: "alkali-metal" },
  { number: 38, symbol: "Sr", name: "Strontium", mass: 87.62, group: 2, period: 5, category: "alkaline-earth-metal" },
  { number: 39, symbol: "Y", name: "Yttrium", mass: 88.90584, group: 3, period: 5, category: "transition-metal" },
  { number: 40, symbol: "Zr", name: "Zirconium", mass: 91.22, group: 4, period: 5, category: "transition-metal" },
  { number: 41, symbol: "Nb", name: "Niobium", mass: 92.90637, group: 5, period: 5, category: "transition-metal" },
  { number: 42, symbol: "Mo", name: "Molybdenum", mass: 95.95, group: 6, period: 5, category: "transition-metal" },
  { number: 43, symbol: "Tc", name: "Technetium", mass: 96.90636, group: 7, period: 5, category: "transition-metal" },
  { number: 44, symbol: "Ru", name: "Ruthenium", mass: 101.1, group: 8, period: 5, category: "transition-metal" },
  { number: 45, symbol: "Rh", name: "Rhodium", mass: 102.9055, group: 9, period: 5, category: "transition-metal" },
  { number: 46, symbol: "Pd", name: "Palladium", mass: 106.42, group: 10, period: 5, category: "transition-metal" },
  { number: 47, symbol: "Ag", name: "Silver", mass: 107.868, group: 11, period: 5, category: "transition-metal" },
  { number: 48, symbol: "Cd", name: "Cadmium", mass: 112.41, group: 12, period: 5, category: "transition-metal" },
  { number: 49, symbol: "In", name: "Indium", mass: 114.818, group: 13, period: 5, category: "post-transition-metal" },
  { number: 50, symbol: "Sn", name: "Tin", mass: 118.71, group: 14, period: 5, category: "post-transition-metal" },
  { number: 51, symbol: "Sb", name: "Antimony", mass: 121.76, group: 15, period: 5, category: "metalloid" },
  { number: 52, symbol: "Te", name: "Tellurium", mass: 127.6, group: 16, period: 5, category: "metalloid" },
  { number: 53, symbol: "I", name: "Iodine", mass: 126.9045, group: 17, period: 5, category: "halogen" },
  { number: 54, symbol: "Xe", name: "Xenon", mass: 131.29, group: 18, period: 5, category: "noble-gas" },
  { number: 55, symbol: "Cs", name: "Cesium", mass: 132.905452, group: 1, period: 6, category: "alkali-metal" },
  { number: 56, symbol: "Ba", name: "Barium", mass: 137.33, group: 2, period: 6, category: "alkaline-earth-metal" },
  { number: 57, symbol: "La", name: "Lanthanum", mass: 138.9055, group: null, period: 6, category: "lanthanide" },
  { number: 58, symbol: "Ce", name: "Cerium", mass: 140.116, group: null, period: 6, category: "lanthanide" },
  { number: 59, symbol: "Pr", name: "Praseodymium", mass: 140.90766, group: null, period: 6, category: "lanthanide" },
  { number: 60, symbol: "Nd", name: "Neodymium", mass: 144.24, group: null, period: 6, category: "lanthanide" },
  { number: 61, symbol: "Pm", name: "Promethium", mass: 144.91276, group: null, period: 6, category: "lanthanide" },
  { number: 62, symbol: "Sm", name: "Samarium", mass: 150.4, group: null, period: 6, category: "lanthanide" },
  { number: 63, symbol: "Eu", name: "Europium", mass: 151.964, group: null, period: 6, category: "lanthanide" },
  { number: 64, symbol: "Gd", name: "Gadolinium", mass: 157.25, group: null, period: 6, category: "lanthanide" },
  { number: 65, symbol: "Tb", name: "Terbium", mass: 158.92535, group: null, period: 6, category: "lanthanide" },
  { number: 66, symbol: "Dy", name: "Dysprosium", mass: 162.5, group: null, period: 6, category: "lanthanide" },
  { number: 67, symbol: "Ho", name: "Holmium", mass: 164.93033, group: null, period: 6, category: "lanthanide" },
  { number: 68, symbol: "Er", name: "Erbium", mass: 167.26, group: null, period: 6, category: "lanthanide" },
  { number: 69, symbol: "Tm", name: "Thulium", mass: 168.93422, group: null, period: 6, category: "lanthanide" },
  { number: 70, symbol: "Yb", name: "Ytterbium", mass: 173.05, group: null, period: 6, category: "lanthanide" },
  { number: 71, symbol: "Lu", name: "Lutetium", mass: 174.9667, group: null, period: 6, category: "lanthanide" },
  { number: 72, symbol: "Hf", name: "Hafnium", mass: 178.49, group: 4, period: 6, category: "transition-metal" },
  { number: 73, symbol: "Ta", name: "Tantalum", mass: 180.9479, group: 5, period: 6, category: "transition-metal" },
  { number: 74, symbol: "W", name: "Tungsten", mass: 183.84, group: 6, period: 6, category: "transition-metal" },
  { number: 75, symbol: "Re", name: "Rhenium", mass: 186.207, group: 7, period: 6, category: "transition-metal" },
  { number: 76, symbol: "Os", name: "Osmium", mass: 190.2, group: 8, period: 6, category: "transition-metal" },
  { number: 77, symbol: "Ir", name: "Iridium", mass: 192.22, group: 9, period: 6, category: "transition-metal" },
  { number: 78, symbol: "Pt", name: "Platinum", mass: 195.08, group: 10, period: 6, category: "transition-metal" },
  { number: 79, symbol: "Au", name: "Gold", mass: 196.96657, group: 11, period: 6, category: "transition-metal" },
  { number: 80, symbol: "Hg", name: "Mercury", mass: 200.59, group: 12, period: 6, category: "transition-metal" },
  { number: 81, symbol: "Tl", name: "Thallium", mass: 204.383, group: 13, period: 6, category: "post-transition-metal" },
  { number: 82, symbol: "Pb", name: "Lead", mass: 207, group: 14, period: 6, category: "post-transition-metal" },
  { number: 83, symbol: "Bi", name: "Bismuth", mass: 208.9804, group: 15, period: 6, category: "post-transition-metal" },
  { number: 84, symbol: "Po", name: "Polonium", mass: 208.98243, group: 16, period: 6, category: "metalloid" },
  { number: 85, symbol: "At", name: "Astatine", mass: 209.98715, group: 17, period: 6, category: "halogen" },
  { number: 86, symbol: "Rn", name: "Radon", mass: 222.01758, group: 18, period: 6, category: "noble-gas" },
  { number: 87, symbol: "Fr", name: "Francium", mass: 223.01973, group: 1, period: 7, category: "alkali-metal" },
  { number: 88, symbol: "Ra", name: "Radium", mass: 226.02541, group: 2, period: 7, category: "alkaline-earth-metal" },
  { number: 89, symbol: "Ac", name: "Actinium", mass: 227.02775, group: null, period: 7, category: "actinide" },
  { number: 90, symbol: "Th", name: "Thorium", mass: 232.038, group: null, period: 7, category: "actinide" },
  { number: 91, symbol: "Pa", name: "Protactinium", mass: 231.03588, group: null, period: 7, category: "actinide" },
  { number: 92, symbol: "U", name: "Uranium", mass: 238.0289, group: null, period: 7, category: "actinide" },
  { number: 93, symbol: "Np", name: "Neptunium", mass: 237.048172, group: null, period: 7, category: "actinide" },
  { number: 94, symbol: "Pu", name: "Plutonium", mass: 244.0642, group: null, period: 7, category: "actinide" },
  { number: 95, symbol: "Am", name: "Americium", mass: 243.06138, group: null, period: 7, category: "actinide" },
  { number: 96, symbol: "Cm", name: "Curium", mass: 247.07035, group: null, period: 7, category: "actinide" },
  { number: 97, symbol: "Bk", name: "Berkelium", mass: 247.07031, group: null, period: 7, category: "actinide" },
  { number: 98, symbol: "Cf", name: "Californium", mass: 251.07959, group: null, period: 7, category: "actinide" },
  { number: 99, symbol: "Es", name: "Einsteinium", mass: 252.083, group: null, period: 7, category: "actinide" },
  { number: 100, symbol: "Fm", name: "Fermium", mass: 257.09511, group: null, period: 7, category: "actinide" },
  { number: 101, symbol: "Md", name: "Mendelevium", mass: 258.09843, group: null, period: 7, category: "actinide" },
  { number: 102, symbol: "No", name: "Nobelium", mass: 259.101, group: null, period: 7, category: "actinide" },
  { number: 103, symbol: "Lr", name: "Lawrencium", mass: 266.12, group: null, period: 7, category: "actinide" },
  { number: 104, symbol: "Rf", name: "Rutherfordium", mass: 267.122, group: 4, period: 7, category: "transition-metal" },
  { number: 105, symbol: "Db", name: "Dubnium", mass: 268.126, group: 5, period: 7, category: "transition-metal" },
  { number: 106, symbol: "Sg", name: "Seaborgium", mass: 269.128, group: 6, period: 7, category: "transition-metal" },
  { number: 107, symbol: "Bh", name: "Bohrium", mass: 270.133, group: 7, period: 7, category: "transition-metal" },
  { number: 108, symbol: "Hs", name: "Hassium", mass: 269.1336, group: 8, period: 7, category: "transition-metal" },
  { number: 109, symbol: "Mt", name: "Meitnerium", mass: 277.154, group: 9, period: 7, category: "transition-metal" },
  { number: 110, symbol: "Ds", name: "Darmstadtium", mass: 282.166, group: 10, period: 7, category: "transition-metal" },
  { number: 111, symbol: "Rg", name: "Roentgenium", mass: 282.169, group: 11, period: 7, category: "transition-metal" },
  { number: 112, symbol: "Cn", name: "Copernicium", mass: 286.179, group: 12, period: 7, category: "transition-metal" },
  { number: 113, symbol: "Nh", name: "Nihonium", mass: 286.182, group: 13, period: 7, category: "post-transition-metal" },
  { number: 114, symbol: "Fl", name: "Flerovium", mass: 290.192, group: 14, period: 7, category: "post-transition-metal" },
  { number: 115, symbol: "Mc", name: "Moscovium", mass: 290.196, group: 15, period: 7, category: "post-transition-metal" },
  { number: 116, symbol: "Lv", name: "Livermorium", mass: 293.205, group: 16, period: 7, category: "post-transition-metal" },
  { number: 117, symbol: "Ts", name: "Tennessine", mass: 294.211, group: 17, period: 7, category: "halogen" },
  { number: 118, symbol: "Og", name: "Oganesson", mass: 295.216, group: 18, period: 7, category: "noble-gas" },
];
