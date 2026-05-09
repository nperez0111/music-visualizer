import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _mainSchema = /*#__PURE__*/ v.record(
  /*#__PURE__*/ v.string(),
  /*#__PURE__*/ v.object({
    $type: /*#__PURE__*/ v.literal("com.nickthesick.catnip.pack"),
    /**
     * What changed in this version
     * @maxLength 4096
     */
    changelog: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
        /*#__PURE__*/ v.stringLength(0, 4096),
      ]),
    ),
    createdAt: /*#__PURE__*/ v.datetimeString(),
    /**
     * AT-URI of the parent com.nickthesick.catnip.release record
     */
    release: /*#__PURE__*/ v.resourceUriString(),
    /**
     * Semver version string
     * @minLength 1
     * @maxLength 64
     */
    version: /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
      /*#__PURE__*/ v.stringLength(1, 64),
    ]),
    /**
     * The .viz archive (ZIP containing the pack)
     * @accept application/zip
     * @maxSize 16777216
     */
    viz: /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.blob(), [
      /*#__PURE__*/ v.blobSize(16777216),
      /*#__PURE__*/ v.blobAccept(["application/zip"]),
    ]),
  }),
);

type main$schematype = typeof _mainSchema;

export interface mainSchema extends main$schematype {}

export const mainSchema = _mainSchema as mainSchema;

export interface Main extends v.InferInput<typeof mainSchema> {}

declare module "@atcute/lexicons/ambient" {
  interface Records {
    "com.nickthesick.catnip.pack": mainSchema;
  }
}
