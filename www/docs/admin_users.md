# Admin - Users

The Users screen manages every account that can sign in to the main application, and which of them have admin permission to reach the Admin UI itself.

## Layout

Two lists side by side:

- Regular Users: everyday accounts without admin permission.
- Administrators: accounts with admin permission, able to access every Admin UI screen.

Each list shows a running count as a badge.

## Managing accounts

- Add a new regular user or a new admin directly by entering an email address and clicking the matching Add button.
- Promote a regular user to admin with "Make Admin".
- Remove an account with the Remove button; you cannot remove the account you are currently signed in with.
- Your own account is marked with a "You" badge so it is easy to identify in the list.

Creating an account assigns its account ID and permissions immediately. The
user then enrolls their browser with that email and their real name in the
planner and saves the generated account key. Assigned admin permission is
preserved; the user does not need to enroll before you create the admin account.
Creating an account does not issue its browser credentials to the administrator.

## Reset account access

Use **Reset access** for an enrolled account whose browsers or account key are
lost. Confirm the reset, then save the replacement key displayed in the shared
account-key modal before checking the save confirmation and continuing. Give
the key to the account owner through a trusted channel.

Reset revokes every remembered browser and active session for the account and
invalidates its old account key. It preserves the account ID, name, permissions,
and Azure PAT. The account owner should use **Enrollment** with the replacement
key and save the next key shown after enrollment.

Resetting your own access signs you out. Save the key before confirming; the
planner opens afterward so you can enroll again. Do not close or reload the key
dialog before saving. If the key is lost, another authenticated administrator
or the installation operator must issue a fresh reset.

See [Account Access](account_access.md) for the account owner's instructions.

Restoring User accounts from a backup can reinstate older keys and browsers,
invalidate newer keys, or revive deleted accounts. Use Reset access for users
who cannot enroll, sign in again, or delete their accounts afterward. Ensure
an administrator has snapshot-valid credentials before restoring accounts.
Administrator Remove and self-service Delete account both remove the account,
PAT, owned saved views/scenarios, and authentication. Retained backups and
offline drafts on other browsers are outside that deletion.

## Notes

- Email addresses are validated on entry.
- There is currently only one permission level beyond a plain account: `admin`. There is no finer-grained per-screen permission — any admin account can use every Admin UI screen described in this manual.
- Status messages confirm success or report an error after each change, and clear automatically after a few seconds.
