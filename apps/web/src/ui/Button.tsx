import { forwardRef, type ButtonHTMLAttributes } from 'react';

import './overlays.css';

export type UiButtonVariant = 'primary' | 'secondary' | 'danger';

export interface UiButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: UiButtonVariant;
}

/** Shared overlay button; geometry and press feedback come from the tokens. */
export const UiButton = forwardRef<HTMLButtonElement, UiButtonProps>(
  function UiButton(
    { variant = 'secondary', className, type = 'button', ...props },
    ref
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={
          className ? `ptcgsim-ui-button ${className}` : 'ptcgsim-ui-button'
        }
        data-variant={variant}
        {...props}
      />
    );
  }
);
