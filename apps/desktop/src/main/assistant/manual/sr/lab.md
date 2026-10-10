---
id: lab
title: Laboratorija
location: { module: lab }
keywords: [laboratorija, serijski port, arduino, baterija, osciloskop, ton, svetlo]
---
Laboratorija je fioka sa hardverom: serijski port, baterija, ton i svetlo — instrumenti u jednoj sobi, svaki u svojoj kartici.

Kako se koristi:

1. „Serijski port“: „Izaberi port“ otvara izbor uređaja (nikada se ne bira sam), pa se bira „Brzina (baud)“, „Kraj reda“ („CRLF (kako Arduino štampa)“, „LF“, „Bez kraja reda“) i „Tumačenje“ („Terminal“, „NMEA GPS“, „CSV senzori“). Tu su i „Hex prikaz“, „Sačuvaj log“ i „Očisti prikaz“. U „NMEA GPS“ se vidi pozicija („Geografska širina“, „Geografska dužina“, „Satelita“, „Kvalitet“), a u „CSV senzori“ dnevnik: „Napravi dnevnik“, „Zapisuj“, „Izvezi CSV“.
2. „Baterija“: „Pročitaj izveštaj“ čita izveštaj koji Windows piše i pokazuje stanje („Trenutno:“ — „na bateriji“ ili „na struji“). Ispod je „Van mreže — dnevni bilans“: uređaj se dodaje kroz „Uređaj“, „Snaga (W)“ i „Sati dnevno“ dugmetom „Dodaj uređaj“, a „Baterija (Wh)“, „Dubina pražnjenja“, „Sati sunca“ i „Dana zaliha“ daju figure „Potrošnja dnevno“, „Traje“, „Baterija za zalihu“ i „Potreban panel“ (panel se računa sa efikasnošću punjenja, koja piše ispod). Listu pamti „Sačuvaj listu“.
3. „Ton i osciloskop“: oblik („Sinus“, „Pravougaoni“, „Trougaoni“, „Testera“, „Beli šum“, „Roze šum“), „Frekvencija (Hz)“, „Pređi preko opsega (20 Hz → 20 kHz)“, „Jačina“ i „Uključi mikrofon“ za osciloskop. Pre početka stoji upozorenje da ton ide na zvučnike ili slušalice i da glasna i dugačka reprodukcija trajno oštećuje sluh; ton je isključen dok se ne klikne.
4. „Svetlo“: „Površina“ („Belo svetlo“ ili „Crveno (noćni režim)“) sa „Jačinom“, dugmad „Uključi“/„Isključi“, lampa preko celog ekrana („Escape“ je zatvara) i „Morse lampica“ koja traži potvrdu pre treptanja.

Ograničenja: port se otvara samo klikom i samo na ovoj stranici; ton i mikrofon se ne uključuju sami; lampica ne treperi ako sistem traži smanjenu animaciju. Dnevnici senzora i sačuvani logovi ostaju na ovom računaru.

Povezano: signals, workshop
