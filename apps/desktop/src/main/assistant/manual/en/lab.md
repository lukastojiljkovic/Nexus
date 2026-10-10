---
id: lab
title: The Lab
location: { module: lab }
keywords: [lab, serial port, arduino, battery, oscilloscope, tone, light]
---
The Lab is the hardware drawer: a serial terminal, the battery and a power budget, a tone generator with a scope, and a lamp — the instruments in one room, each on its own card.

How to use it:

1. "Serial port": "Choose a port" opens the device picker (a port is never chosen for you), then "Speed (baud)", "Line ending" ("CRLF (what an Arduino prints)", "LF", "No line ending") and "Reading" ("Terminal", "NMEA GPS", "CSV sensors"). There are also "Hex view", "Save the log" and "Clear the view". In "NMEA GPS" the position shows ("Latitude", "Longitude", "Satellites", "Quality"), and in "CSV sensors" the log: "Create the log", "Log it", "Export CSV".
2. "Battery": "Read the report" reads the report Windows writes and shows the state ("Now:" — "on battery" or "on mains"). Below it is "Off grid — the daily budget": a device is added through "Device", "Draw (W)" and "Hours a day" with "Add a device", and "Battery (Wh)", "Depth of discharge", "Hours of sun" and "Days of reserve" give the figures "Consumption a day", "Lasts", "Battery for the reserve" and "Panel needed" (the panel figure assumes a charge efficiency, stated below it). "Save the list" keeps the list.
3. "Tone and oscilloscope": the shape ("Sine", "Square", "Triangle", "Sawtooth", "White noise", "Pink noise"), "Frequency (Hz)", "Sweep the range (20 Hz → 20 kHz)", "Level" and "Turn the microphone on" for the scope. Before it starts there is a warning that the tone goes to speakers or headphones and that loud sound for long enough damages hearing permanently; the tone is off until it is clicked.
4. "Light": "Surface" ("White light" or "Red (night mode)") with a "Brightness", the "Turn on"/"Turn off" buttons, a lamp across the whole screen ("Escape" closes it) and a "Morse lamp" that asks for an acknowledgement before flashing.

Limits: a port opens only on a click, and only on this page; the tone and the microphone never start on their own; the lamp does not flash when the system asks for reduced motion. Sensor logs and saved logs stay on this computer.

Related: signals, workshop
