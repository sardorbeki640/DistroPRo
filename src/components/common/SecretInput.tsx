import React from 'react';

/**
 * A field for API keys, bot tokens and integration passwords. It is masked on screen but is NOT a password field:
 * browsers save type="password" fields as "the password for this site" and later paste the key into the sign-in form.
 */
export const SecretInput: React.FC<Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { reveal?: boolean }> = ({ reveal = false, style, ...rest }) => (
  <input
    {...rest}
    type="text"
    autoComplete="off"
    autoCorrect="off"
    autoCapitalize="off"
    spellCheck={false}
    data-lpignore="true"
    data-1p-ignore="true"
    data-form-type="other"
    style={{ ...(reveal ? {} : { WebkitTextSecurity: 'disc' } as React.CSSProperties), ...style }}
  />
);
