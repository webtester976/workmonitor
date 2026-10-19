
          </div>

        </div>

      </div>

      {/* PREVIEW */}

      {previewModal && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() =>
            setPreviewModal(
              null
            )
          }
        >

          <div
            className="w-full max-w-6xl"
            onClick={(
              event
            ) =>
              event.stopPropagation()
            }
          >

            <div className="flex justify-end mb-2">

              <button
                type="button"
                onClick={() =>
                  setPreviewModal(
                    null
                  )
                }
                className="cursor-pointer p-2 text-white"
              >
                <X className="w-6 h-6" />
              </button>

            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl overflow-hidden">

              {(() => {
                const source =
                  previewModal.driveThumbnailLink ||
                  previewModal.previewDataUrl ||
                  '';

                const displayUrl =
                  employeeScreenshotUrls[source] ||
                  (source.startsWith('data:') || source.startsWith('blob:')
                    ? source
                    : '');

                return displayUrl ? (
                  <img
                    src={displayUrl}
                    alt="Screenshot preview"
                    className="w-full max-h-[80vh] object-contain bg-slate-950"
                  />
                ) : (
                  <div className="min-h-[320px] flex items-center justify-center bg-slate-950 text-slate-400">
                    Loading screenshot...
                  </div>
                );
              })()}

              <div className="p-4">

                <div className="font-bold">
                  {
                    previewModal.taskName
                  }
                </div>

                <div className="text-xs text-slate-500 mt-1">
                  {
                    previewModal.timeFormatted
                  }
                </div>

              </div>

            </div>

          </div>

        </div>
      )}

      {/* HIDDEN VIDEO */}

      <video
        ref={
          screenVideoRef
        }
        autoPlay
        muted
        playsInline
        className="fixed -top-[9999px] -left-[9999px] w-[320px] h-[180px] opacity-[0.001] pointer-events-none"
      />

    </div>
  );
};
