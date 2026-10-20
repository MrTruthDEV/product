# iFruit

Toto je hotová stránka. Už je to HTML, CSS a JavaScript. Netreba ju prepisovať.

Otvorí sa na oznámení eventu New Era. Program ide iTag, iBuds a na koniec iFruit 18 Pro.

Súbor `index.html` je úvod. Štýl je v `assets/`. Obrázky, telefón a ostatné súbory sú vedľa neho.

## Ako z toho spraviť GitHub Page

1. Na GitHube vytvor nové verejné repo. Meno napríklad `iFruit`. README nepridávaj.
2. Tento priečinok nahraj cez Git. Tlačidlo Upload files na webe nestačí, lebo živý telefón má mapy a priečinok má asi 215 MB.
3. V PowerShelli, keď máš nainštalovaný Git a repo je prázdne:

```
cd C:\Users\zmija\Desktop\iFruit-github
git init
git add .
git commit -m "iFruit site"
git branch -M main
git remote add origin https://github.com/TVOJE-MENO/iFruit.git
git push -u origin main
```

4. V repe otvor Settings, potom Pages. Build and deployment nastav na Deploy from a branch, vetva `main`, priečinok `/ (root)` a ulož.
5. O chvíľu bude stránka na `https://TVOJE-MENO.github.io/iFruit/`.

`TVOJE-MENO` vymeň za svoje GitHub meno a `iFruit` za skutočný názov repa.
