# Релиз 2.0: что осталось на сервере и на сайте, одним списком

Составлено 01.10.2026 ночью, чат «Предрелиз». Всё, что можно было проверить, не меняя боевой
сервер, проверено. Что-либо менять на боевом классификатор Claude Code без прямой фразы Alex не
даёт (так и вышло: `git push vps master` заблокирован как Production Deploy), поэтому здесь
готовые шаги: после фразы они выполняются подряд, минут за пять.

## Что уже проверено (ничего не менялось)

- Сервер eye-mint на VPS: `skr-eye-mint` и `skr-eye-mint-lab` активны, в `/opt/skr-eye-mint` код
  **2100738** (`EYE_PAY=skr` умеет). Локальный мастер **1ce7a21** на два коммита впереди: атрибут
  `proof` «fingerprint on a Seeker» в Attributes-плагине и в описании глаза (когда палец обязателен).
  Он постоянный в цепочке, поэтому должен уехать **до первого боевого минта**.
- Тесты: сервер `node --test` 261/261; приложение `npm run test:eye` 24/24 против нового
  построителя транзакций (атрибут влезает в предел приложения 512 байт / 32 записи).
- Казна: SKR-аккаунт `CmTWwMrSusqhxrABLMnMfTKnZHosoHWczRbnsj5cLGX4` существует на цепочке,
  инициализирован, владелец `BmJa…uax` (kosa.skr), минт SKR. Сервер в SKR-режиме сверяет, что адрес
  равен производному от кошелька комиссий, иначе не стартует.
- Боевой env `/etc/skr-eye-mint.env` сейчас без `EYE_PAY` и `EYE_SKR_*` (то есть SOL). В нём уже
  `EYE_DEV=0`, `EYE_REQUIRE_FINGER=1`, `EYE_FREEZE_EYES=owner`, `EYE_OPEN_ENABLED=1`.
  Лаб-env уже на SKR (`EYE_PAY=skr`, казна та же, 100 / 150 / 1 SKR).
- Журнал: `journald` без `MaxRetentionSec`, режется только по размеру (сейчас 527 МБ), у
  `skr-eye-mint` с 27.09. Политика на сайте обещает «не больше 30 дней», значит нужна строка ниже.

## Фраза для классификатора (одна, на всё)

> Разрешаю: выкатить eye-mint на сервер (git push vps master, npm ci, перезапуск skr-eye-mint),
> поставить в /etc/skr-eye-mint.env EYE_PAY=skr и EYE_SKR_TREASURY=CmTWwMrSusqhxrABLMnMfTKnZHosoHWczRbnsj5cLGX4,
> поставить journald срок хранения 30 дней, выложить новые Privacy и Terms на сайт и поставить
> подписанную сборку на мой телефон.

## Шаги

1. **Копия env.** `ssh root@82.117.84.56 'cp -a /etc/skr-eye-mint.env /etc/skr-eye-mint.env.bak-20261001-before-skr'`
2. **Код.** Из `C:\Users\Alex Kosa\skr-eye-mint`: `git push vps master`; на сервере
   `cd /opt/skr-eye-mint && export PATH=/opt/node-v24.21.0/bin:$PATH && npm ci --omit=dev`.
3. **Env: SKR.** В конец `/etc/skr-eye-mint.env`:
   ```
   # SKR only (Alex, 29.09; 01.10 for production): the Eye and the Blink are paid in SKR.
   EYE_PAY=skr
   EYE_SKR_TREASURY=CmTWwMrSusqhxrABLMnMfTKnZHosoHWczRbnsj5cLGX4
   EYE_SKR_OPEN_UNITS=100000000
   EYE_SKR_OPEN_UNITS_AFTER=150000000
   EYE_SKR_BLINK_UNITS=1000000
   ```
4. **Журнал 30 дней.** `/etc/systemd/journald.conf.d/retention.conf` с
   `[Journal]` / `MaxRetentionSec=30day`, затем `systemctl restart systemd-journald`.
5. **Перезапуск.** `systemctl restart skr-eye-mint` (лаб не трогать, пока Alex проверяет по нему;
   на диске код уже новый, лаб подхватит его при своём следующем перезапуске).
6. **Проверка.** `journalctl -u skr-eye-mint -n 30` должен сказать `PAID IN SKR (EYE_PAY=skr)`;
   `curl -s http://127.0.0.1:8787/eye/health` отдаёт цены в SKR; снаружи
   `https://skr.alexkosa.dev/eye/health`; `scripts/reconcile.mjs --full` без расхождений; сторож
   коллекции на ПК (`watch.log`) не тревожится.
7. **Сайт.** `scp -r site/. root@82.117.84.56:/var/www/skr-eyes/` (scp ничего не удаляет),
   затем `chown -R www-data:www-data /var/www/skr-eyes`. Проверить в браузере
   `https://skr-eyes.alexkosa.dev/privacy` и `/terms`.
8. **Телефон.** Подписанная сборка уже собрана и проверена: `builds/skr-eyes-2.0.0-rc8-release.apk`
   (копия в `C:\skrx\builds\`), SHA-256 файла `aa03114a99fd83df64af620902a8e9faf1f54af0db7fc56d546dd3796172648a`,
   подписант `CN=skr.alexkosa.dev`, отпечаток `d90bb194…e4763`, `apksigner verify` OK. Пакет сторовый
   `dev.alexkosa.skreyes` (2.0.0, код 10), не лаб: ставится рядом с лабом, а поверх прежнего
   сторового 1.x обновляет его. `adb -s SM02E4072810627 install -r builds\skr-eyes-2.0.0-rc8-release.apk`,
   потом глазами каждый экран; кошелёк подписывает только Alex. Если код после этой сборки менялся,
   пересобрать: `powershell -ExecutionPolicy Bypass -File scripts\build-release.ps1 -Name <имя>`
   (сам проверит отпечаток и удалит файл с чужим).

## Откат

- Env: `cp -a /etc/skr-eye-mint.env.bak-20261001-before-skr /etc/skr-eye-mint.env && systemctl restart skr-eye-mint`.
- Код: `cd /opt/skr-eye-mint && git reset --hard 2100738 && systemctl restart skr-eye-mint`
  (`git push vps` обновляет рабочее дерево, откат делается на самом сервере).
- Сайт: прежние `privacy.html` и `terms.html` лежат в git этой ветки до коммита с новыми.

## Что решает Alex, а не я

- Публиковать ли 2.0 и когда: в магазин подаёт только он.
- Мир при толпе выбран им (Радужка, «мне нравится мирок»); осталось подтвердить порог: Восхождение
  до 30 глаз, Радужка с 31-го, или Радужка всегда.
- Какие памятки зашить в NFT при открытии и после Blink: `docs/drafts/nft-keepsakes-2.0.md`.
  Что пишется при открытии, не дописать потом, поэтому решать **до первого боевого минта**, то есть
  до выкатки этого списка.
- Входит ли автостейк собранного SKR (D-035) в 2.0 или идёт следом: в этой сборке его нет, он
  меняет `txCheck` и сервер.
- Строка в Terms про исходники говорит «parts of the project's source are published»: это верно
  для 1.x и веб-сервиса; если 2.0 уйдёт в публичный репозиторий, фразу можно усилить.
