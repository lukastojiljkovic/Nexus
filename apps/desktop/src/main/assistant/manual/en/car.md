---
id: car
title: Car
location: { module: car }
keywords: [car, service, fuel, odometer, interval, fault, registration]
---
The Car module is a service book: vehicles, services, intervals, fuel and faults. Each vehicle keeps its own pages, and the vehicle is chosen on the page itself.

How to use it:

1. "Garage": "Add a vehicle" asks for "Name", "Make", "Model", "Year", "Plate", "VIN (optional)", "Fuel" ("Petrol", "Diesel", "LPG", "CNG", "Hybrid", "Electric", "Other") and "Distance unit" (km or mi). "Archive" puts a car away and keeps its whole history.
2. "Intervals": one interval per kind of service ("Oil", "Filters", "Tyres", "Brakes", "Battery", "Timing belt", "Technical inspection", "Registration", "Repair", "Other") — kilometres, months, or both; whichever comes first is due. No interval, no deadline.
3. "Service log": "Add a service" writes the date, the kind, the description, the price and its currency, and the garage; a receipt hangs off the service ("Add a receipt"). "Odometer" is what today's estimate and every measured distance rest on ("Add a reading", and "A new odometer (replacement)" when the odometer was replaced).
4. "Fuel": "Add a fill" writes the date, the quantity, the odometer, the price per unit or the total, and the "The tank is full" switch. Consumption is measured from full tank to full tank; the fills in between are summed, and a stretch with no full tank is left out. "Faults" remember what happens and what helped.

The "Due soon" thresholds (days and kilometres) cover every vehicle and are changed in Settings, on the "Car" card. Everything stays in the profile on this computer.

Related: finance-transactions, content-packs
