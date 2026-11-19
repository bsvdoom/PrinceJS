# Audit javítási terv

**Állapot:** megvalósítva (D1–D3 jóváhagyva). Az eltéréseket és a tényleges változtatásokat a dokumentum végi [Megvalósítás](#megvalósítás) szakasz írja le.
**Alap:** a 2026-11-19-i audit (`b6f98b6` commit). Kiinduláskor a 31 teszt zöld, az ESLint tiszta.

## Alapelv: az eredeti DOS-játékmenet hű reprodukálása

Minden javításnál az eredeti DOS-os Prince of Persia viselkedése a mérce, ez a legfontosabb szempont.

- **Referencia:** az [SDLPoP](https://github.com/NagyD/SDLPoP), a DOS-bináris visszafejtett C-forrása. Az idézett függvénynevek innen valók.
- **Port-specifikus funkciók** (érintés, gamepad, megahit, URL-állapot): ahol van DOS-megfelelőjük, ott a DOS-szabályt követik. Ahol nincs, ott nem adhatnak a DOS-hoz képest előnyt vagy hátrányt.
- **Időzítés:** a DOS-ban minden játékmeneti időzítő képkocka-számláló (12 fps, kb. 83 ms). Itt ennek a 80 ms-os `updateWorld` tick felel meg. Az időzítőket ezért tickben számoljuk, nem `setTimeout`-tal. Így szünetben megállnak, és pálya- vagy állapotváltáskor maguktól elvesznek, ahogy a DOS-ban is.
- **Időtartamok:** a meglévő időtartamokat megtartjuk, csak a mechanizmust cseréljük. Kivétel, ha a DOS-érték ismert és eltér.

### Az SDLPoP-ból ellenőrzött DOS-tények

| Téma                                         | DOS-viselkedés                                                                                                                                                                                                                                                                                  | Forrás                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Őr kábulása                                  | Minden kardtalálat után `guard_refrac = refractimer[guard_skill]`. Az őr addig nem támad. Szobába lépéskor `guard_refrac = 0`.                                                                                                                                                                  | `check_sword_hurt`, `enter_guard`, `autocontrol_guard_*` |
| Életerő pályakezdéskor                       | Pálya teljesítésekor `hitp_beg_lev = hitp_max`, vagyis csak a **max** HP öröklődik. Minden nem-seamless pályakezdés és újraindítás **teljes** HP-val indul (`hitp_curr = hitp_beg_lev`). Csak a seamless 12→13 átmenet viszi át az aktuális HP-t.                                               | `do_startpos`, `play_level_2`                            |
| Szünet                                       | Esc → `is_paused`. A `play_frame` nem fut, így az idő sem telik.                                                                                                                                                                                                                                | `do_paused`                                              |
| Szintugrás (Shift+L)                         | Csak `current_level < 4` vagy cheat módban. Cheat nélkül `rem_min > 15` esetén 15 percre vág. A 14. szintről az 1.-re lép.                                                                                                                                                                      | `process_key`                                            |
| Szint újraindítása                           | Bármikor, kivéve a 15. szinten. Megerősítés nincs.                                                                                                                                                                                                                                              | `process_key`                                            |
| Folytatás halál után                         | Csak `Kid.alive > 6` után, és csak **Shift vagy Enter** indítja (ilyenkor Ctrl+A-ra fordul); a nyomva tartott Shift is számít. _Javítva a terv után:_ az `alive` 7 már a halálzene indulásakor elérhető, tehát a halálzene **alatt** is lehet újraindítani; a felirat a zene végén jelenik meg. | `play_kid`, `process_key`                                |
| Jaffar ébredése                              | `guard_notice_timer = 28` képkocka, ami 2,3 s. Ez megegyezik a jelenlegi 2300 ms-mal.                                                                                                                                                                                                           | `meet_Jaffar`                                            |
| Tüskék                                       | Ha a nyers módosító ≥ 5 (nem negatív) vagy 0xFF, a tüske **ártalmatlan**. Animációt csak a `modifier ≤ 0` indít.                                                                                                                                                                                | `is_spike_harmful`, `start_anim_spike`                   |
| Láncolt események                            | A lánc minden elemére ugyanaz a `button_type` vonatkozik. Ha a kid a gombon hal meg, az egész lánc stuck/debris lesz.                                                                                                                                                                           | `do_trigger_list`, `trigger_1`, `died_on_button`         |
| Kiesés a pályáról                            | Ha nincs szoba lent, a kid kiesik és meghal (`fell_out`).                                                                                                                                                                                                                                       | `fell_out`                                               |
| Feather fall                                 | `FEATHER_FALL_LENGTH` = 18,75 s, kb. 225 képkocka. A jelenlegi 18000 ms éppen 225 tick.                                                                                                                                                                                                         | `feather_fall`                                           |
| Játékidő (a terv után ellenőrizve)           | Az idő csak a `play_frame`-ben, **élő kiddel** telik; átvezető, halál után és a 14. szinten nem. A 13. szinten Jaffar halálakor megáll. Időlejárat (`expired`) csak a 13. szint előtt van.                                                                                                      | `show_time`, `play_frame`                                |
| 13. szint kijárata (a terv után ellenőrizve) | Nem időzítő nyitja: Jaffar halála után, amikor a kid **balra kilép egy szobából**, a 24-es szoba gombja aktiválódik.                                                                                                                                                                            | `Jaffar_exit`, `leave_room`                              |
| 8. szint egere (a terv után ellenőrizve)     | A `leveldoor_open` csak a 16-os szobában számol tovább; 150-nél jön az egér.                                                                                                                                                                                                                    | `timers`                                                 |
| Bemenet                                      | Nincs puffer: képkockánként a lenyomott állapot számít. Az SDLPoP `fix_register_quick_input` csak a két képkocka között lenyomott-felengedett billentyűt őrzi meg a következő képkockáig.                                                                                                       | `read_keyb_control`, `read_user_control`                 |
| „Press Button” lejárta                       | 288 képkocka után a játék a címképernyőre áll vissza (ezt a PrinceJS már így csinálta).                                                                                                                                                                                                         | `play_frame`                                             |

## Döntési pontok (megvalósítás előtt kell jóváhagyás)

- **D1. Folytatás halál után.**
  - **Ajánlott:** DOS-hűen csak Shift vagy Enter indítsa, és csak a „Press Button to Continue” felirat megjelenése után, azaz a halálzene végén. Érintésnél egy koppintás, gamepadnél egy arcgomb (a D-pad nem).
  - **Jelenleg:** bármelyik billentyű 0,8 s után újraindít.
- **D2. Érintéses és gamepad szintnavigáció.**
  - **Ajánlott:**
    - A „következő szint” ugyanazt a DOS-szabályt kövesse, mint a Shift+L: 1–3. szint, vagy megahit, és 15 perc vágás.
    - Az „előző szint” csak megahit módban legyen elérhető, mert DOS-megfelelője nincs.
    - Az „újraindítás” maradjon, ez a Ctrl+A megfelelője.
  - **Jelenleg:** a gamepad +/− gomb és az alsó érintősáv korlátozás és büntetés nélkül léptet.
- **D3. Billentyű-puffer harcban** (700 ms TTL, a `b6f98b6` commitból).
  - A DOS csak az előző képkocka óta lenyomott billentyűket „jegyzi meg”, ami 1 tick.
  - A 700 ms azt okozza, hogy a sorba állított vágás vagy védés érezhetően késve sül el.
  - **Ajánlott:** a harci TTL-t 1–2 tickre (80–160 ms) csökkenteni, és a 200 ms-os általános TTL-t megtartani.
  - Mivel ez a legutóbbi szándékos változtatást érinti, külön jóváhagyás kell.

## 0. fázis – Közös infrastruktúra

**0.1. `PrinceJS.Utils.gameDelayed(game, fn, ms)`** a [src/Utils.js](../src/Utils.js) fájlban

- `game.time.events.add` alapú időzítő.
- Ellenőrizve a `lib/phaser.js` forrásában: a `StateManager.clearCurrentState` hívja a `time.removeAll()`-t, a `Time.gamePaused` pedig szünetelteti a timereket.
- Így állapotváltáskor magától törlődik, és szünetben áll.
- Minden nem-játékmeneti (UI, átvezető) késleltetéshez ezt használjuk.

**0.2. Tick-alapú számlálók a játékmenethez**

- A `setTimeout`-os játékmeneti késleltetések helyére számláló mezők kerülnek, amelyeket az `updateWorld` (Game) vagy az aktor `update` csökkent.
- A pálya újraindításakor (új `Game` state, új aktorok) automatikusan nullázódnak.

**0.3. A régi `Utils.delayed` / `delayedCancelable` megtartása**

- Csak ott maradnak, ahol szándékosan valós időre van szükség, például a gamepad 500 ms-os debounce-ánál.
- Leltár: 35 hívási hely. Mindegyiket besoroljuk: tick, `gameDelayed` vagy marad.

## 1. fázis – Magas prioritás

### 1.1. Az őr elveszíti a találat utáni kábulását

- **Hiba:**
  - Az [Interface.js:162](../src/Interface.js#L162) `resetOpponentLive` hívása `onDamageLife.removeAll()` és `onDead.removeAll()`. Ez az őr saját `resetRefracTimer` listenerét is leveszi ([Enemy.js:30](../src/Enemy.js#L30)).
  - Ettől kezdve minden elválás vagy ellenfélváltás után az őr találat után azonnal visszavág.
- **DOS:** minden találat után `guard_refrac`.
- **Javítás:**
  - Csak a UI saját kezelőit vesszük le: `this.opp.onDamageLife.remove(this.damageOpponentLive, this)` és `this.opp.onDead.remove(this.resetOpponentLive, this)`.
  - Az `Enemy` szobába lépéskor (amikor újra ellenfél lesz) nullázza a `refracTimer`-t, ahogy az `enter_guard` is teszi.
- **Teszt:** unit teszt arra, hogy egy `setOpponentLive(a)` → `setOpponentLive(b)` → `setOpponentLive(a)` sorozat után az `a.onDamageLife` még tartalmazza a `resetRefracTimer` listenert.

### 1.2. Pontos szüneteltetés (az idő ne nyerhető és ne veszíthető)

- **Hiba:**
  - Az [Utils.js:458](../src/Utils.js#L458) `restoreQuery` folytatáskor a perc elejére igazítja az időt.
  - Szimulációval mérve: +59 s nyereség, vagy a teljes szünetidő levonása.
- **DOS:** szünet alatt az idő egyáltalán nem telik.
- **Javítás:**
  - `onPause`: `PrinceJS.pausedAt = Date.now()`, majd `updateQuery()`.
  - `onResume`: ha van `startTime` és nincs `endTime`, akkor `startTime += Date.now() - pausedAt`, utána `pausedAt = null`.
  - A `restoreQuery` perc-igazítása megszűnik.
  - Az URL `t` paraméterébe továbbra is a hátralévő perc kerül. Ezt csak az oldal újratöltése olvassa, ez nem változik.
- **Kapcsolódó:** a szünet alatt futó mechanikák (feather fall, Jaffar ajtó, egér, őr ébredése) a 2. fázisban tick-alapúak lesznek, így szünetben megállnak.
- **Teszt:** a `scratchpad/pause.js` szimulációt unit tesztté alakítjuk: 5 s, 40 s és perchatáron átnyúló szünet után a hátralévő idő pontosan a szünet előtti.

### 1.3. A gamepad nem aktiválhatja az érintősávot, a navigáció a DOS-szabályt követi

- **Hiba:**
  - A [Game.js:182-213](../src/Game.js#L182-L213) `update` a `continueGame()` igaz értékénél (bármely gamepad-gomb, D-pad is) az _utolsó egérpozíciót_ vizsgálja az alsó 4%-os sávban.
  - A gamepad +/− gomb korlátozás és időbüntetés nélkül léptet.
- **Javítás:**
  - A `continueGame` szétválik `pointerReleased` és `gamepadContinuePressed` hívásra. Az utóbbi csak arcgombokat figyel, D-padet és tengelyt nem.
  - Az érintősáv-vizsgálat csak valódi pointer-felengedésnél fut.
  - Közös `requestNextLevel(source)` és `requestPreviousLevel(source)` függvény, amely a D2 döntés szerint alkalmazza a DOS-szabályt.
    - A Shift+L, a gamepad + és az érintősáv jobb széle is ezen megy át.
    - A 14. szintről ugrás a DOS szerint az 1. szintre visz.
  - Az újraindítás (Shift+A, gamepad X második nyomása, érintősáv közepe) a 15. szinten tiltott, ahogy a DOS-ban is.

## 2. fázis – Állapotváltásokon átszivárgó időzítők

### 2.1. A címképernyő ne rabolja el a játékot

- **Hely:** [Title.js:50-51](../src/Title.js#L50-L51).
- **Javítás:** `gameDelayed(this.game, () => this.cutscene(), 3500)`. A `play()`-jel induló state-váltás automatikusan törli.

### 2.2. Átvezetők (Cutscene, Credits, EndTitle)

- Az `onDownCallback` 1 s-os visszakötése [Cutscene.js:59](../src/Cutscene.js#L59), [Credits.js:47](../src/Credits.js#L47) és [EndTitle.js:42](../src/EndTitle.js#L42) helyén `gameDelayed`-re cserélődik.
- A `fadeIn` és `fadeOut` callbackjei ([Cutscene.js:226](../src/Cutscene.js#L226), [Cutscene.js:235](../src/Cutscene.js#L235)) szintén `gameDelayed`-re cserélődnek.
- Kiegészítő védelem: egy `this.leaving` flag, hogy a `next()`, `play()` és `continue()` csak egyszer fusson le.
- Ellenőrizzük, hogy az érintéses és gamepades átugrás a Cutscene-ben ugyanazt az utat használja, mint a billentyű.

### 2.3. Game: pálya-szkript időzítők tickre

- **13. szint, Jaffar halála utáni ajtónyitás** ([Game.js:529-537](../src/Game.js#L529-L537)):
  - `this.level.openExitDoorTicks = 88` (≈ 7 s), az `updateWorld` csökkenti, 0-nál jön a `button.push()`.
  - **Jaffar észlelése** nem a `kid.opponent` alapján történik, hanem a `this.enemies` közül a `baseCharName === "jaffar"` szereplővel. Ez javítja a megahit K cheat okozta soft-lockot (a kid `opponent`-je ilyenkor már `null`), és a duplakiütéses esetet is.
- **8. szint, egér várakozása** ([Game.js:413-417](../src/Game.js#L413-L417)): `waitForMouseTicks = 156` (≈ 12,5 s).
- **6. szint, leesés utáni szintváltás** ([Game.js:403-406](../src/Game.js#L403-L406)) és **`timeUp`**: `gameDelayed`.
- **A `create()` 100 ms-os `turn`-je:** `gameDelayed`.

### 2.4. Aktorok

- **Feather fall** ([Kid.js:1975-1987](../src/Kid.js#L1975-L1987)): `this.floatTicks = 225`, a Kid tickje csökkenti. A `toggleFloatFall` és a halál nullázza.
- **Őr ébredése** ([Enemy.js:91-100](../src/Enemy.js#L91-L100)):
  - Tickenkénti új `setTimeout` helyett egy számláló: `startFightTicks = jaffar ? 28 : 6`.
  - Akkor indul, amikor a `willStartFight()` először igaz, és nullázódik, ha hamis lesz.
  - Az időtartam ugyanaz marad (a Jaffar 28 tick értéke DOS-pontos), de nincs timer-áradat.
- **Többi aktor-`delayed`** ([Fighter.js:104](../src/Fighter.js#L104), [Fighter.js:1108](../src/Fighter.js#L1108), [Kid.js:155](../src/Kid.js#L155), [Kid.js:234](../src/Kid.js#L234), [Kid.js:690](../src/Kid.js#L690), [Kid.js:2070](../src/Kid.js#L2070), [Potion.js:50](../src/tiles/Potion.js#L50)): egyenként besoroljuk, és tickre vagy `gameDelayed`-re cseréljük. Az időtartam nem változik.
- **Interface** ([Interface.js:223](../src/Interface.js#L223), [Interface.js:280](../src/Interface.js#L280)): `gameDelayed`.

## 3. fázis – Halál, újraindítás, életerő

### 3.1. `restartGame` takarítás

- **Hely:** [Game.js:831](../src/Game.js#L831).
- **Hiba:** az `enemies` tömb nem ürül, a „szellem” őrök tovább frissülnek.
- **Javítás:**
  - Közös `cleanupLevel()`: `this.enemies = []`, `this.kid`/`this.ui` leválasztás, a cheat keydown handler eltávolítása.
  - Ezt a `reset()`, a `restartGame()` és a `shutdown()` is hívja.

### 3.2. Életerő a DOS szerint

- **Hiba:**
  - A [Game.js:853](../src/Game.js#L853) és a [Kid.js:67](../src/Kid.js#L67) miatt a `currentHealth` újraindítás után is megmarad.
  - A 13. szintre alacsony HP-val érkezve minden halál után alacsony HP-val indulsz újra.
- **Javítás:**
  - Újraindításkor (`restartLevel`, halál utáni folytatás, `restartGame`): `PrinceJS.currentHealth = null`, vagyis teljes HP (`hitp_beg_lev`).
  - Szintlépéskor csak a `maxHealth` öröklődik. Az aktuális HP csak a seamless 12→13 átmenetnél, és a döntés az **elhagyott pálya `level.number === 12`** feltételén alapul, nem az abszolút szintszámon. Így az egyedi pályacsomagokban is működik.
  - A megahit mentés betöltése ([Utils.js:560](../src/Utils.js#L560)) a betöltött pályára adja vissza a HP-t. Utána egy halál a DOS-hoz hasonlóan teljes HP-ra állít.

### 3.3. Folytatás halál után (D1)

- **Hiba:** a [Game.js:599-612](../src/Game.js#L599-L612) `continueTimer` 10 tick után bármely billentyűt elfogad, az autorepeatet is. A „Press Button” felirat ([Interface.js](../src/Interface.js) `showPressButtonToContinue`) csak 4 s múlva jelenik meg.
- **Javítás (az ajánlott D1 szerint):**
  - Az újraindítás csak a felirat megjelenése után engedélyezett. Ennek feltétele a DOS `alive > 6` megfelelője: a halálzene vége.
  - Billentyűzetről csak Shift vagy Enter indítja, érintésről egy koppintás, gamepadről egy arcgomb.
  - A 260 tick utáni automatikus visszatérés a címképernyőre marad (a DOS 288 tickje 12 fps-en ≈ 24 s).
- **Szint vége** (`pressButtonToNext`): az `event.repeat` billentyűket figyelmen kívül hagyjuk, hogy a nyomva tartott irányítóbillentyű ne ugorja át a szintvégi zenét.

## 4. fázis – Edge case-ek és apró hibák

| #   | Hely                                                                           | Javítás                                                                                                                                                                                                                                | DOS-indok            |
| --- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 4.1 | [Kid.js:1108-1116](../src/Kid.js#L1108-L1116) `changeRoomDown`                 | `links.right` ≤ 0 esetén `room = 0` → `outOfRoom` → halál (nincs TypeError). A bal oldali ág már így működik.                                                                                                                          | `fell_out`           |
| 4.2 | [Game.js:39](../src/Game.js#L39), Preloader                                    | Betöltés előtt `cache.removeJSON("level")`, így hiányzó pálya esetén a fallback lefut. Az `applyQuery` csak létező szinteket fogadjon el (1–16, illetve a ténylegesen meglévő egyedi pályák). A 310. utáni „következő” vissza a címre. | – (port)             |
| 4.3 | [Spikes.js:8](../src/tiles/Spikes.js#L8)                                       | Nyers módosító ≥ 5 (vagy 0xFF): a tüske inert, nem aktiválódik, nincs hang és sebzés. Előbb ellenőrizni kell, hogy a konverter a nyers DOS-módosítót adja-e át (192., 208., 210., 221. pálya).                                         | `is_spike_harmful`   |
| 4.4 | [Level.js:267](../src/Level.js#L267) `fireEvent`                               | A `stuck` paraméter a láncon is továbbadódik: `this.fireEvent(event + 1, type, stuck)`.                                                                                                                                                | `do_trigger_list`    |
| 4.5 | [Interface.js:124-128](../src/Interface.js#L124-L128)                          | Az `opp` csak akkor kerül tárolásra, ha valóban HP-sáv készült. Inaktív vagy csontváz szereplőnél `opp = null`, így később újra lehet próbálni.                                                                                        | `enter_guard` HP-sáv |
| 4.6 | [Fighter.js:301](../src/Fighter.js#L301)                                       | A mindig igaz `charFrame !== "kid"` feltétel törlése. A csattanás mindkét félnél szól, ez a jelenlegi és a helyes viselkedés.                                                                                                          | –                    |
| 4.7 | [Utils.js:305](../src/Utils.js#L305), [Utils.js:314](../src/Utils.js#L314)     | `PrinceJS.Utils.minutes` → `PrinceJS.minutes`.                                                                                                                                                                                         | –                    |
| 4.8 | [Preloader.js:96](../src/Preloader.js#L96)                                     | `if (this.game.sound.context && this.game.sound.context.resume)` védelem.                                                                                                                                                              | –                    |
| 4.9 | Kid `CMD_NEXTLEVEL`, `skipShowLevel` ([Game.js:839](../src/Game.js#L839) stb.) | A 13/14-es döntéseket a `level.number` alapján hozzuk, nem a `currentLevel` alapján, hogy az egyedi csomagokban is DOS-szerűen működjenek.                                                                                             | –                    |

## Szándékosan nem változik (DOS-hű vagy port-sajátság)

- **Shift+A és Shift+R megerősítés nélkül:** a DOS Ctrl+A és Ctrl+R sem kér megerősítést. A böngészőben a Ctrl+A/R foglalt, ezért a Shift a helyettesítő.
- **Beégetett események az egyedi pályákon:** a DOS-motor `level.number` alapon futtatja őket (6., 12., 14. szint).
- **`onPause`/`onResume` listenerek:** a Phaser Signal nem duplikál, a jelenlegi működés helyes.
- **A 260 tickes automatikus visszatérés a címre:** megfelel a DOS időkeretének.

## Ellenőrzés

- **Unit tesztek** (`tests/`):
  - Az Interface listener megőrzése (1.1).
  - A szünet-időmatematika (1.2).
  - A `changeRoomDown` jobb szélső esete (4.1).
  - A `fireEvent` stuck-öröklése (4.4).
  - A tüske-ártalmasság a módosító szerint (4.3).
  - A `requestNextLevel` szabálymátrixa: szint × megahit × forrás (1.3).
  - Az életerő újraindításkor és 12→13-nál (3.2).
- **Kézi böngészős ellenőrzőlista:**
  - Harc: elválás után az őr a találat után vár.
  - Alt-Tab szünet közben az idő nem változik.
  - Gamepad + lent parkoló egér mellett nincs véletlen szintváltás.
  - Címképernyőn gombnyomás a fekete fázisban → nincs betolakodó cutscene.
  - Cutscene-átugrás érintéssel → az első billentyű nem indítja újra a szintet.
  - 13. szint: halál és újraindítás után teljes HP; Jaffar megölése megahit K-val → az ajtó kinyílik.
  - Halál közben nyomva tartott nyíl → nincs korai újraindítás.
- **Minden fázis után:** `npm test` és lint zöld.

## Megvalósítási sorrend és commit-bontás

1. 0. fázis + 1.1 + 1.2 (infrastruktúra, harc, idő)
2. 1.3 (bemenet és navigáció, a D2 alapján)
3. 2. fázis (időzítők)
4. 3. fázis (halál, újraindítás, életerő, a D1 alapján)
5. 4. fázis (edge case-ek)
6. D3 (billentyű-puffer), ha jóváhagyásra kerül

Mindegyik külön commit, és mindegyik után futnak a tesztek.

## Megvalósítás

Minden fázis és a D1–D3 is elkészült. A változtatások még nincsenek commitolva.

### A terv után, a DOS-forrás alapján pontosított pontok

- **Játékidő (1.2 kiegészítése):** a szünet mellett az óra halál után, átvezetők és pályaváltás alatt, valamint a 14. szinten is áll (`show_time`). A 13. szinttől nincs időlejárat, az óra nullán megáll. Ha a 13. szintet Jaffar halála után újraindítod, az óra onnan folytatódik, ahol megállt.
- **13. szint kijárata (2.3 helyett):** a 7 s-os időzítő megszűnt. Az ajtó akkor nyílik, amikor Jaffar halála után a kid balra kilép egy szobából (`Jaffar_exit`). Jaffar halálát az ellenfelek listájából észleljük, ez javítja a megahit K okozta elakadást is.
- **8. szint egere:** 149 tick a 16-os szobában nyitott ajtóval; a szoba elhagyása szünetelteti a számlálást.
- **D1:** a folytatás a halálzene alatt is lehetséges (DOS `Kid.alive > 6`). A plusz szabály, hogy csak Shift vagy Enter indítja, illetve érintés vagy gamepad arcgomb; a nyomva tartott Shift is.
- **D3:** egységes 1 tickes latch harcban és harcon kívül (`Kid.INPUT_LATCH_TICKS`). A 200/700 ms-os puffer megszűnt.
- **Életerő:** a `currentHealth` egyszer használatos átadás, a `Game.create` fogyasztja el. Bármely újraindítás teljes HP-val indul. A 12→13 átvitel a `level.number === 12` alapján működik, és szintugrásnál nem érvényes.
- **Időlejárat után** nincs újraindítás és szintváltás (DOS `expired`). Korábban a lejárat utáni 1 s-ban egy újraindítás visszaállította a 60 percet.
- **Őr kábulása (1.1 kiegészítése):** ha egy őr újra a kid ellenfele lesz, a `refracTimer` nullázódik (`enter_guard`).

### Fájlok

- `src/Utils.js`:
  - `gameDelayed` és `gamePerform` (játékóra);
  - időtartás: `holdTimer`, `releaseTimer`, `timerNow`, `setRemainingTime`, `resumeEndTime`;
  - `isPlayableLevel`, `levelNumber`, `levelNumberOf`, `isHarmfulSpikes`, `gamepadContinuePressed`;
  - a `restoreQuery` megszűnt.
- `src/Boot.js`: globális szünet-tartás.
- `src/Game.js`:
  - cache-ürítés; tiszta `create` és `shutdown`;
  - közös szintugrási szabály: `canSkipLevel`, `requestNextLevel`, `requestPreviousLevel`;
  - a gamepad és a pointer szétválasztása;
  - tickes egér; Jaffar-kijárat;
  - folytatás és időlejárat logikája.
- `src/Interface.js`: csak a saját listenerek eltávolítása; a HP-sáv nem emlékszik inaktív szereplőre; időlejárat a 13. szint előtt.
- `src/Enemy.js`: `startFightTimer` (Jaffar 28 tick, őr 6 tick).
- `src/Kid.js`:
  - 225 tickes feather fall;
  - 1 tickes bemeneti latch;
  - `changeRoomDown` védelem;
  - `level.number` alapú döntések.
- `src/Fighter.js`, `src/tiles/Spikes.js`: a tüskeszabály, és a halott feltétel törlése.
- `src/Level.js`: a `stuck` öröklése a láncon.
- `src/Title.js`, `src/Cutscene.js`, `src/Credits.js`, `src/EndTitle.js`: játékórás késleltetések és egyszeri kilépés.
- `src/Preloader.js`: WebAudio-védelem.
- Egyéb állapothoz kötött `delayed` hívások → `gameDelayed`: `LevelBuilder`, `Potion`, `Fighter`, `Kid`. A képernyő-villogás (`flash*`) és a gamepad-debounce szándékosan valós időn maradt.

### Ellenőrzés

- **Unit tesztek:** 57/57 zöld. Ebből 22 új: `tests/dos-fidelity.test.js`. A régi bemeneti tesztek (`kid-input-responsiveness`) a DOS-szemantikára lettek átírva: a nyomva tartott billentyű működik, a korábban elengedett nem.
- **Lint és formázás:** ESLint és Prettier tiszta.
- **Headless Chrome füstteszt** (33 ellenőrzés, mind sikeres, konzolhiba és warning nélkül):
  - az 1–14. pálya és 8 egyedi pálya betöltése;
  - a `restartGame` nem halmoz ellenfeleket;
  - halál: az óra áll, a nyíl nem, a Shift igen indít újra, teljes HP-val;
  - 3 s szünet: az idő nem változik;
  - Shift+L szabály;
  - Jaffar: az óra megáll, és a balra kilépés nyitja az ajtót;
  - 310 után a címképernyő;
  - a Title késleltetett átvezetője nem rabolja el a játékot.
