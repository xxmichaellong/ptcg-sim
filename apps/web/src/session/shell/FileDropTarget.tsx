import { Trans, useLingui } from '@lingui/react/macro';
import { FileArrowUpIcon } from '@phosphor-icons/react/dist/csr/FileArrowUp';
import { useEffect, useRef, useState } from 'react';

import { toast } from '../../ui/toast.js';
import './file-drop-target.css';

const carriesFiles = (event: DragEvent): boolean =>
  event.dataTransfer?.types.includes('Files') === true;

/**
 * Takes a file dragged onto the window: a replay at a Solo table, a saved
 * game in a room (`onFile` says whether it took it), as their pickers in the
 * menu would. While a file is held over the page it says it can be dropped.
 * Cards dragged on the table are pointer drags, not files: they never
 * show it.
 */
export const FileDropTarget = ({
  onFile,
}: {
  readonly onFile: (file: File) => boolean;
}) => {
  const { t } = useLingui();
  const [over, setOver] = useState(false);
  const latest = useRef(onFile);
  latest.current = onFile;
  // Entering and leaving fire for every element crossed: count them.
  const depth = useRef(0);
  useEffect(() => {
    const enter = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setOver(true);
    };
    const overPage = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const leave = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const drop = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      depth.current = 0;
      setOver(false);
      // A drop something on the page took already (the deck screen's own
      // import of a list) is not the window's to open as well.
      if (event.defaultPrevented) return;
      event.preventDefault();
      const file = event.dataTransfer?.files[0];
      if (!file) return;
      if (!latest.current(file)) {
        toast({
          title: t`That file can't be opened here.`,
          tone: 'warning',
        });
      }
    };
    globalThis.addEventListener('dragenter', enter);
    globalThis.addEventListener('dragover', overPage);
    globalThis.addEventListener('dragleave', leave);
    globalThis.addEventListener('drop', drop);
    return () => {
      globalThis.removeEventListener('dragenter', enter);
      globalThis.removeEventListener('dragover', overPage);
      globalThis.removeEventListener('dragleave', leave);
      globalThis.removeEventListener('drop', drop);
      depth.current = 0;
    };
  }, [t]);
  return (
    <div
      className="ptcgsim-file-drop"
      data-over={over ? 'true' : undefined}
      aria-hidden={!over}
    >
      <div className="ptcgsim-file-drop__label">
        <FileArrowUpIcon aria-hidden="true" weight="bold" />
        <Trans>Drop to open</Trans>
      </div>
    </div>
  );
};
