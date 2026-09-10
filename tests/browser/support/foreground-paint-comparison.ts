import type { Page, TestInfo } from '@playwright/test';

export interface ForegroundPaintComparisonOptions {
  readonly spatialTolerance: number;
  readonly channelTolerance: number;
  readonly foregroundChannelThreshold?: number;
}

export const SOURCE_CARD_PAINT_COMPARISON_OPTIONS = Object.freeze({
  spatialTolerance: 3,
  channelTolerance: 24,
  foregroundChannelThreshold: 250,
}) satisfies ForegroundPaintComparisonOptions;

export const SOURCE_CARD_PAINT_MAX_UNMATCHED_RATIO = 0.025;

export interface ForegroundPaintComparison {
  readonly width: number;
  readonly height: number;
  readonly sourceForegroundPixels: number;
  readonly candidateForegroundPixels: number;
  readonly unmatchedSourcePixels: number;
  readonly unmatchedCandidatePixels: number;
  readonly unmatchedSourceRatio: number;
  readonly unmatchedCandidateRatio: number;
}

export const attachForegroundPaintComparison = async (
  testInfo: TestInfo,
  attachmentPrefix: string,
  source: Buffer,
  candidate: Buffer,
  comparison: ForegroundPaintComparison
): Promise<void> => {
  await Promise.all([
    testInfo.attach(`${attachmentPrefix}-source.png`, {
      body: source,
      contentType: 'image/png',
    }),
    testInfo.attach(`${attachmentPrefix}-candidate.png`, {
      body: candidate,
      contentType: 'image/png',
    }),
    testInfo.attach(`${attachmentPrefix}-comparison.json`, {
      body: Buffer.from(JSON.stringify(comparison, null, 2)),
      contentType: 'application/json',
    }),
  ]);
};

export const compareForegroundScreenshots = (
  page: Page,
  source: Buffer,
  candidate: Buffer,
  options: ForegroundPaintComparisonOptions
): Promise<ForegroundPaintComparison> =>
  page.evaluate(
    async ({ sourceUrl, candidateUrl, options }) => {
      const pixels = async (url: string) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Screenshot pixel canvas is unavailable');
        context.drawImage(image, 0, 0);
        return {
          width: canvas.width,
          height: canvas.height,
          data: context.getImageData(0, 0, canvas.width, canvas.height).data,
        };
      };
      const [sourcePixels, candidatePixels] = await Promise.all([
        pixels(sourceUrl),
        pixels(candidateUrl),
      ]);
      if (
        sourcePixels.width !== candidatePixels.width ||
        sourcePixels.height !== candidatePixels.height
      ) {
        throw new Error(
          `Screenshot dimensions differ: source ${sourcePixels.width}x${sourcePixels.height}, candidate ${candidatePixels.width}x${candidatePixels.height}`
        );
      }
      const foregroundThreshold = options.foregroundChannelThreshold ?? 250;
      const foreground = (data: Uint8ClampedArray, offset: number): boolean =>
        (data[offset] ?? 255) < foregroundThreshold ||
        (data[offset + 1] ?? 255) < foregroundThreshold ||
        (data[offset + 2] ?? 255) < foregroundThreshold;
      const matchesNearby = (
        sourceData: Uint8ClampedArray,
        candidateData: Uint8ClampedArray,
        x: number,
        y: number
      ): boolean => {
        const sourceOffset = (y * sourcePixels.width + x) * 4;
        for (
          let deltaY = -options.spatialTolerance;
          deltaY <= options.spatialTolerance;
          deltaY += 1
        ) {
          const candidateY = y + deltaY;
          if (candidateY < 0 || candidateY >= sourcePixels.height) continue;
          for (
            let deltaX = -options.spatialTolerance;
            deltaX <= options.spatialTolerance;
            deltaX += 1
          ) {
            const candidateX = x + deltaX;
            if (candidateX < 0 || candidateX >= sourcePixels.width) continue;
            const candidateOffset =
              (candidateY * sourcePixels.width + candidateX) * 4;
            let matches = true;
            for (let channel = 0; channel < 4; channel += 1) {
              if (
                Math.abs(
                  (sourceData[sourceOffset + channel] ?? 0) -
                    (candidateData[candidateOffset + channel] ?? 0)
                ) > options.channelTolerance
              ) {
                matches = false;
                break;
              }
            }
            if (matches) return true;
          }
        }
        return false;
      };
      const unmatched = (
        sourceData: Uint8ClampedArray,
        candidateData: Uint8ClampedArray
      ) => {
        let foregroundPixels = 0;
        let unmatchedPixels = 0;
        for (let y = 0; y < sourcePixels.height; y += 1) {
          for (let x = 0; x < sourcePixels.width; x += 1) {
            const offset = (y * sourcePixels.width + x) * 4;
            if (!foreground(sourceData, offset)) continue;
            foregroundPixels += 1;
            if (!matchesNearby(sourceData, candidateData, x, y)) {
              unmatchedPixels += 1;
            }
          }
        }
        return { foregroundPixels, unmatchedPixels };
      };
      const sourceResult = unmatched(sourcePixels.data, candidatePixels.data);
      const candidateResult = unmatched(
        candidatePixels.data,
        sourcePixels.data
      );
      return {
        width: sourcePixels.width,
        height: sourcePixels.height,
        sourceForegroundPixels: sourceResult.foregroundPixels,
        candidateForegroundPixels: candidateResult.foregroundPixels,
        unmatchedSourcePixels: sourceResult.unmatchedPixels,
        unmatchedCandidatePixels: candidateResult.unmatchedPixels,
        unmatchedSourceRatio:
          sourceResult.unmatchedPixels / sourceResult.foregroundPixels,
        unmatchedCandidateRatio:
          candidateResult.unmatchedPixels / candidateResult.foregroundPixels,
      };
    },
    {
      sourceUrl: `data:image/png;base64,${source.toString('base64')}`,
      candidateUrl: `data:image/png;base64,${candidate.toString('base64')}`,
      options,
    }
  );
