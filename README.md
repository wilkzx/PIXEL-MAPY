# PixelMapy – mapy do Minecraft (HTML + GitHub Pages + Supabase)

Strona to zwykły HTML/CSS/JS hostowany za darmo na **GitHub Pages**.
GitHub Pages nie uruchamia serwerów, więc konta, mapy i polubienia trzyma darmowy **Supabase** (baza + logowanie).
Strona łączy się z nim bezpośrednio, a prawa dostępu pilnuje baza (plik `supabase.sql`).

## 1. Supabase (5 minut)
1. Wejdź na https://supabase.com, załóż konto i kliknij **New project** (nazwa dowolna, zapamiętaj hasło bazy).
2. Po utworzeniu: **SQL Editor → New query**, wklej całą zawartość `supabase.sql` i kliknij **Run**.
3. **Authentication → Providers → Email**: wyłącz **Confirm email**, jeśli chcesz, żeby rejestracja działała od razu bez klikania w maila.
4. **Project Settings → API**: skopiuj **Project URL** i klucz **anon public**.
5. Wklej je do pliku `config.js`. Klucza **service_role** nigdy nie wklejaj.

## 2. Konto admina
Zarejestruj się na swojej stronie jako:
- nazwa: `wilkzx`
- email: `brajangrochal@gmail.com`
- hasło: wybierz własne (np. `palion12`; Supabase wymaga minimum 6 znaków)

Konto z tym emailem automatycznie dostaje rolę admina (robi to baza), więc w menu pojawi się **Panel admina**.
**Zarejestruj to konto jako pierwsze**, zanim ktokolwiek inny pozna adres strony. Email jest wtedy zajęty.
Hasła w plikach strony nie ma i nie powinno być: repozytorium na GitHubie jest publiczne.

## 3. GitHub Pages
1. Utwórz repozytorium na GitHubie i wgraj wszystkie pliki (`index.html`, `style.css`, `app.js`, `config.js`, `supabase.sql`, `README.md`).
2. **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, Branch = `main` / `(root)` → Save.
3. Po minucie strona jest pod `https://TWOJA-NAZWA.github.io/NAZWA-REPO/`.
4. W Supabase: **Authentication → URL Configuration** ustaw **Site URL** na ten adres.

## Kto co może
- Niezalogowany: przeglądać, pobierać, logować się i rejestrować
- Zalogowany: dodatkowo wrzucać mapy (po akceptacji admina), lubić mapy, edytować profil
- Admin: panel z wszystkimi mapami (pobieranie, akceptacja, odrzucanie, usuwanie) i listą użytkowników.
  Mapy admina publikują się od razu.

## Aktualizacja: bany i eventy
Jeśli bazę założyłeś starszą wersją `supabase.sql`, uruchom w SQL Editor plik `update-eventy-bany.sql`
(nowy `supabase.sql` zawiera już wszystko, więc przy świeżej instalacji wystarczy on jeden).

- **Panel admina → Konta i bany**: lista kont z emailami, ostatnim logowaniem i liczbą map. Ban na 1/3/7/30 dni lub na stałe, odbanowanie.
  Zbanowany nie doda mapy, nie polubi i nie zmieni profilu (pilnuje tego baza). Admina nie da się zbanować.
- **Panel admina → Eventy**: nazwa (np. EVENT 2026), wygląd (The End / Nether / Zima), liczba dni. Event zmienia wygląd całej strony,
  pokazuje odliczanie i 3 mapy z największą liczbą pobrań + polubień. Po czasie pokazuje zwycięzcę. Możesz go zatrzymać, wznowić lub usunąć.
