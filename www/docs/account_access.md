# Account Access

PlannerTool remembers each enrolled browser. You do not choose a password or
receive an email verification link. Your account email identifies your account;
it is not enough on its own to sign in after enrollment.

## Enroll your account

1. Open PlannerTool's **Enrollment** dialog.
2. Enter your work email address and real name, then click **Enroll**.
3. Save the account key displayed in the next dialog in a password manager or
   another private, secure location outside the project repository.
4. Check **I have saved this key. It will not be shown again.**, then click
   **Continue**.

Use only your own email address. If your account existed before the authentication
upgrade, enrollment preserves its permissions and Azure Personal Access Token
(PAT). For an already enrolled account, enter your current account key in the
same Enrollment form; email and name cannot replace its credentials. After your
email is checked, Enrollment shows Real name for first enrollment or Account key
for an already enrolled account, never both.

Keep your account key private. It grants access to your account, including deletion. PlannerTool
cannot show an existing key again because the server stores only its hash.

## Configuration and account email

Open **Configuration** from the gear button. **Account email** is displayed as
non-editable text: it identifies the account currently signed in. Configuration
does not change account identity.

The Azure **Personal Access Token (PAT)** is separate from your account key.
Enter your Azure PAT in the PAT field when Azure access requires it, then click
**Save**. Never paste a PlannerTool account key into that field.

## Enroll another browser or sign in again

Use the same Enrollment flow on a new browser, after sign-out, after clearing
cookies, or when a remembered browser expires or is revoked.

1. Open PlannerTool's **Enrollment** dialog.
2. Enter your account email and current account key.
3. Click **Enroll**.
4. Save the replacement account key shown in the dialog, replacing the old key
   in your secure storage. Confirm it is saved, then click **Continue**.

Successful enrollment consumes the old key, so it cannot be used again. Enrollment
adds the current browser but does not revoke other remembered browsers. If a
browser was lost or stolen, revoke it separately.

## Revoke a remembered browser

In **Configuration**, click **Refresh device list** under **Remembered browsers**.
The list shows short browser IDs and expiry dates; **this browser** marks the
current one. Click **Revoke** beside a browser to remove its access, including its
active sessions.

Revoking the current browser means it will need Enrollment with your current
account key the next time authentication is required. Save that key before doing
this. Revocation does not delete the account or
change its permissions, and other browsers remain enrolled.

Browsers are remembered for up to 90 days of inactivity. Normal authenticated use
renews that period. Ordinary session expiry or a server restart can renew access
automatically from a valid remembered browser.

## Ask an administrator to reset access

If you have lost your latest account key, ask an
administrator to open **Users** and use **Reset access** for your account.

A reset revokes every remembered browser and active session, and replaces the
account key. It preserves your account email, account ID, name, PAT, and
permissions. The administrator receives the new key in a save-and-confirm modal
and must hand it to you through a trusted channel. Use **Enrollment** with that
key, then save the next replacement key displayed after enrollment.

If you reset your own account as an administrator, save the key before confirming.
PlannerTool then returns to the main application, where you can choose
**Enrollment**. Do not reload or close the reset dialog before saving the key.

If the replacement key is lost, the previous key no longer works. Another
authenticated administrator must reset access again. If no administrator can
authenticate, contact the installation operator; email alone cannot unlock the
account.

## Sign-out and account removal

Open **Configuration**, click **Sign out**, and confirm. This revokes the current
browser's remembered credential and sessions, removes its authentication cookies,
clears PlannerTool preferences, cached data, and local drafts, and reloads to
account access. Save your work first: local drafts cannot be recovered afterward.
If server sign-out fails, local data is retained and you can try again.

Server-saved data, your account, Azure PAT, permissions, account key, and other
enrolled browsers are unchanged. To return, use **Enrollment** with your current
account key. Closing a tab or browser
alone does not sign out.

PlannerTool local storage is shared by installations on the same origin. Sign-out
also clears their shared local preferences and drafts, but does not remove their
server data. Storage belonging to unrelated applications is left alone.

To remove your account, choose **Delete account** in Configuration or the
Enrollment dialog, enter your current account key, and confirm. This deletes
your account, PAT, saved views/scenarios, and all server access. No replacement
key is issued. The final administrator cannot delete their account. Other
browsers lose server access, but offline drafts and previously retained backups
cannot be erased remotely. Signing out is not account deletion.

## Common problems

- **Account already enrolled:** enter your current account key in Enrollment.
- **Account key rejected:** use the latest key saved after the most recent
   enrollment or administrator reset. Previously consumed or replaced keys no longer
  work.
- **Access disappeared after reset:** every browser was revoked. Enroll with the
  replacement key issued by that reset.
- **Azure data cannot be read or saved after sign-in:** check your Azure PAT and
   permissions. A PlannerTool account key is not an Azure PAT.
- **Key stopped working after a backup restore:** the backup may contain an older
   key. Ask an administrator to use Reset access if you cannot enroll, sign in again,
   or delete your account, then save the replacement key after enrollment.