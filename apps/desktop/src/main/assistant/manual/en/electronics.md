---
id: electronics
title: Electronics
location: { module: electronics }
keywords: [electronics, circuit, arduino, raspberry, components, wires]
---
Electronics is a workspace for building circuits: a catalogue of components, a board to place them on and wires between their pins.

How to build a circuit:

1. In the "Circuits" list click "New circuit" and type the "Circuit name".
2. In the "Components" palette search by name, description or protocol and click "Add to circuit"; the shelves are "Boards", "Sensors", "Actuators", "Drivers and amplifiers", "Displays", "Communication", "Power" and "Passive components".
3. A wire is drawn by clicking a pin ("Click a pin to start a wire") and then a second pin. "Wire colour" is a choice of nine; "Esc" cancels.
4. The right-hand panel shows "About the circuit", "Component" or "Wire" — name in the circuit, rotation, value and removal. "Machine…" describes the machine the circuit sits on.

The same circuit also produces artefacts: "Code" (an Arduino sketch or a ROS 2 package, with its wiring table), "Bench" (how the signal moves through the circuit while the clock runs) and "Runner", which runs an external program on this computer and asks you to turn it on first.

Limits: the code describes the wiring as it is and does not claim the circuit is sound — the checks can report errors beside it. The runner starts a program with the same rights you have.

Related: tools, canvas
