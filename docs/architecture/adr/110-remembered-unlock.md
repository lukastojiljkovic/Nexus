# ADR-110 — „Traži pristupni kod": how often the app asks for the passcode

**Status:** accepted (2026-10-10). **Owner:** the run that finished the wave.
**Amends nothing.** ADR-018 owns the key chain and stays exactly as it is; this
adds one optional, deletable convenience BESIDE it.

## 1. Luka's decision

**A setting where the user picks how often they type the passcode — every time
(today's behaviour), after 1 hour, after 1 day, and so on, or never, so someone
who does not want to type it and accepts reduced security can choose that**
(10 October).

So the passcode screen stops being unconditional. The default is unchanged —
`"every-time"`, which is every launch the product has ever had — and every other
choice is a deliberate weakening the user makes while unlocked, with the
passcode typed once more to make it.

## 2. The setting

In Podešavanja → **Profil i sigurnost** → **Sigurnost**, beside the row that
already governs how long the app waits before locking itself:

| Value | Meaning |
| --- | --- |
| `every-time` (default) | The passcode is asked for at every launch. Nothing is remembered. |
| `1h`, `8h`, `1d`, `7d` | After a passcode unlock, the data key stays wrapped by the OS keystore for that long; a launch inside the window opens without a prompt. |
| `never` | The same, with no expiry at all. |

**Choosing anything other than the default asks for the passcode once more.**
Anything weaker than `every-time` is a privilege over the account, so it is
granted the way every other privileged action is: by proving the passcode
against the live session (`verifyPasscode`), on the unlock's own throttle
counter. Going back to `every-time` needs no passcode — that direction only
tightens the machine. The one sentence the card shows for a weaker choice says
what it costs: *anyone who can use this Windows account can open Nexus without
the passcode for that long*.

The interval a choice means is declared once, in `shared/ipc.ts`
(`UNLOCK_SETTING_MINUTES`), and the row's labels are keyed by the same union —
so main's arithmetic and the word the user reads cannot disagree about what
„after 1 hour" is.

## 3. How it works

**The file.** `<account>/remembered-unlock.json`, plaintext, holding the choice
and (when there is one) the wrapped key:

```jsonc
{
  "version": 1,
  "setting": "1d",
  "wrap": { "wrappedAt": "2026-10-10T12:00:00.000Z", "blob": "<base64 of the keystore's bytes>" }
}
```

It sits beside `keychain.json` in the account directory because that is where
the things a launch needs BEFORE it can read anything live: the database cannot
hold the setting that decides whether the database is opened. It holds no
secret. The setting is not one — it is the same kind of fact as the auto-lock
choice — and the blob is ciphertext only the OS keystore of THIS Windows user
can open.

**The wrap.** After a successful passcode unlock, when the setting is not
`every-time`, main calls `safeStorage.encryptString` on the data key (hex) and
writes the file with the time it wrapped it. On the next launch, main reads the
file before any IPC is answered, and — if the setting remembers, the wrap is
fresh, and this keystore can decrypt it — opens the database, i.e. exactly what
typing the passcode would have done. The wrap is REWRITTEN, never appended to:
one key, one timestamp, one policy.

**The boundary is exclusive of the full duration.** `now − wrappedAt < duration`,
so „after 1 hour" means a launch an hour later asks again, not a launch an hour
and a second later. `never` has no expiry; `every-time` never writes a wrap.

**Unreadable is forgotten, and forgetting means asking.** An expired wrap, a
blob this keystore refuses to decrypt (another Windows account, a copied
profile, an edited file) and a plaintext that is not a 256-bit key are all
deleted and answered as „no wrap". A file that cannot be parsed, or whose
`version` is not 1, reads as the strongest possible state — no wrap, `every-time`
— because a file somebody else wrote must fail towards the passcode prompt.

**What is forgotten, and when** (the brief's list, one line each):

| Event | What happens to the wrap |
| --- | --- |
| „Zaključaj" and every lock the user asks for | deleted — `performLock` is the one function every lock passes through |
| The passcode is changed | deleted; the next unlock writes a fresh one |
| An unlock with the Recovery Kit | deleted, and NOT rewritten: the Kit proved the data key, not the passcode |
| An account is deleted | deleted with the account directory |
| The setting goes back to `every-time` | deleted, and `every-time` is written in as many words |
| The wrap expires, or cannot be decrypted | deleted at the launch that finds it |
| `safeStorage` reports it cannot encrypt | deleted, and nothing is written |

The SETTING survives a deletion — a user who chose „after 1 day" and then locked
has chosen a policy, not a one-off, and the next passcode unlock starts a fresh
window under that policy.

**Where the OS keystore is unavailable, the row is disabled** and says why, in
the two cases that exist:

- `safeStorage.isEncryptionAvailable()` is false — no keystore at all;
- on Linux, `safeStorage.getSelectedStorageBackend()` is `basic_text`, where
  Electron answers that encryption IS available and then encrypts with a
  hard-coded key. A wrap under that backend is a plaintext key in a file that
  LOOKS protected, which is the one failure this feature must not have.

Main refuses the change in both cases as well (`keystoreUnavailable`), because
the renderer is untrusted and a disabled control is not a rule.

## 4. The threat model, plainly

**What it lets in.** Anyone who can use this Windows session. The wrap is bound
to the Windows ACCOUNT, not to a secret the user knows, so a person at the
unlocked machine — or any program running as this user — can have DPAPI open it,
which is precisely what main itself does at startup. This is the cost of the
feature and the reason it is off by default, spelled out in the card's own
sentence and written down here so nobody has to infer it from the code.

**What it still keeps out.**

- **Another Windows user** on the same machine: DPAPI will not decrypt this
  user's blob for them, so the file is bytes.
- **A copied disk, a stolen laptop, a synced folder**: same answer — the blob
  travels, the ability to open it does not.
- **A stolen profile folder** (`accounts/<id>` copied out): same again. The
  wrap is useless without the Windows account that made it, exactly as
  `keychain.json`'s `guard` is (ADR-018's `otherDevice` case).

**What it does not change at all.** The passcode wrap, the device secret, the
Recovery Kit, the throttle and the SQLCipher key are ADR-018's and are untouched.
This ADR adds a SECOND, optional route to the same data key for a bounded time,
deletable by the user and deleted by every lock. ADR-018 §„Rejected" refused
binding the keystore in as an ALTERNATIVE to the passcode, where the passcode
would have protected nothing but file theft. That refusal stands: with
`every-time` — the default, and the state of every install that upgrades — the
product is bit for bit the product ADR-018 shipped.

## 5. Options considered, and why the others lost

- **A renderer `localStorage` preference only.** Refused: `localStorage` lives
  in the renderer, the key lives in main, and a renderer-resident flag deciding
  whether main may skip the passcode is the renderer deciding the lock — the
  exact inversion SEC-EL exists to prevent. The setting is stored in main and
  read by main before the window exists.
- **Extending `keychain.json`** with the setting. Refused for a smaller reason
  but a real one: that file's shape is a versioned contract validated by
  `isKeychainFileShape`, the file is rewritten on every passcode change and
  every recovery, and the wrap has a different LIFETIME from everything in it
  (it is deleted by a lock, while the key chain is not). Two lifetimes, two
  files.
- **A TTL on the wrap counted in wall-clock days with a "never" as a very large
  number.** Refused: `never` is not a big interval, and a number that is
  formatted into a date would eventually be a wrap that expires on a day nobody
  chose.
- **Windows Hello / the OS credential prompt** (SEC-LOC-03's shape). Electron
  exposes no way to PROMPT for the Windows credential, so any such wrap is
  unwrapped by ordinary code running as this user — the same property as this
  design, with a promise the platform cannot keep attached to it.
- **Remembering the passcode-derived KEK instead of the data key.** Refused:
  it would mean keeping the device secret and the Argon2id output resident,
  i.e. the passcode's own material in memory on every launch, to gain nothing
  over wrapping the key the session needs anyway.

## 6. Why the private section is untouched

PRIV (ADR-057) is a SEPARATE vault with its own DEK, its own auto-lock and its
own credential, and it is derived from the ACCOUNT PASSCODE plus the device
secret. Its whole promise is that the private notes are closed behind a
re-authentication that the open session does not satisfy on its own, so a
feature whose entire point is „skip the passcode for a while" cannot be
inherited by it without deleting that promise. The card's copy says nothing about
PRIV and the module's own lock setting is unchanged; nothing in this feature
touches `priv.ts`, its DEK, or its timers.

## 7. Key hygiene, and what a reader can check

- The unwrapped key is the same 256-bit hex string the passcode path hands to
  `openEncrypted`, held by main and dropped by `performLock` — never logged,
  never sent to a renderer, and never in the setting file (the blob is the
  keystore's own ciphertext).
- The buffers this feature makes (the ciphertext coming out of `encryptString`,
  the ciphertext going into `decryptString`) are zeroed with `buffer.fill(0)`
  once their bytes have been used. JS strings cannot be erased; the buffers can,
  and `check:zeroize`'s rule — no key released in the middle of the call using
  it — is unaffected because no `zeroize(` call exists on this path.
- Every IPC payload is validated in main: the setting against `UNLOCK_SETTINGS`
  (`asUnlockSetting`), the passcode with the `asPasscode` shape check, and the
  sender with `assertTrustedSender`.

## 8. Limits this ADR accepts

- **The wrap's clock is the machine's clock.** A user who moves the system clock
  back extends the window; a user who moves it forward shortens it. The wrap is
  a convenience over data this same user can already read, so there is nothing
  here worth a trusted time source — but it is worth stating rather than
  leaving to be discovered.
- **A second Windows session of the SAME user opens too** (a fast-switch
  session, a scheduled task running as the user). That is the same sentence as
  §4's first paragraph, not a second hole, and it is exactly why the card says
  „anyone who can use this Windows account".
