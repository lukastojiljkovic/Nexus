---
id: notes-markdown
title: Formatiranje beleške
location: { module: notes }
keywords: [markdown, formatiranje, prečice, tabela sadržaja, pronađi, prilozi]
---
Beleška se formatira markdown prečicama i menijem komandi koji otvara „/“.

Prečice na početku reda:

1. „# “, „## “, „### “ — naslov 1, 2 ili 3.
2. „- “ ili „* “ — lista; „1. “ — numerisana lista; „> “ — citat; „```“ — blok koda.
3. „/“ otvara meni blokova: naslovi, liste, lista zadataka, citat, blok koda, razdvojač, okviri („Okvir: napomena“, „savet“, „upozorenje“, „opasnost“), „Sklopivi odeljak“, „Sadržaj“, „Kartica (pitanje :: odgovor)“ i „Praznina (cloze)“.
4. „[[“ pravi vezu ka drugoj belešci; povratne veze stoje u panelu „Povratne veze“.
5. Ctrl+Shift+C pravi prazninu (cloze) od izabranog teksta. Ctrl+Z i Ctrl+Y vraćaju i ponavljaju izmenu.

Pretraga unutar beleške: Ctrl+F otvara traku; „Enter“ i „Shift+Enter“ (ili F3 i Shift+F3) idu kroz rezultate, „Esc“ zatvara traku i vraća kursor na rezultat.

Kartice iz beleške: red sa „Kartica (pitanje :: odgovor)“ ili sa prazninama `{{…}}` daje kartice za učenje; u panelu „Kartice“ izaberi „Špil za kartice“, jer bez špila stoji „Napravi špil u modulu Učenje da bi kartice iz ove beleške imale gde da odu.“ Ranije verzije beleške stoje u „Istorija verzija“ („Vrati ovu verziju“).

Ograničenja: markdown prečice mogu da se isključe u Podešavanjima (kartica „Beleške“), ali „/“ meni radi i tada. Slike se u belešku unose kao prilog („Priloži datoteku“), a ne kao spoljna veza.

Povezano: notes, study-cards
