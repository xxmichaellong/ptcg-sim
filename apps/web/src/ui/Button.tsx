import { forwardRef, type ButtonHTMLAttributes } from 'react';

import './overlays.css';

export type UiButtonVariant = 'primary' | 'secondary' | 'danger';

export interface UiButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: UiButtonVariant;
}

/** The one button shape every overlay uses: 34 px tall, pressable. */
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
