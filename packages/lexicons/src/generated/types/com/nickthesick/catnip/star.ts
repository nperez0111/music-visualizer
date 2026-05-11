import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _mainSchema = /*#__PURE__*/ v.record(
  /*#__PURE__*/ v.tidString(),
  /*#__PURE__*/ v.object({
    $type: /*#__PURE__*/ v.literal("com.nickthesick.catnip.star"),
    createdAt: /*#__PURE__*/ v.datetimeString(),
    /**
     * AT-URI of the com.nickthesick.catnip.release record being starred
     */
    subject: /*#__PURE__*/ v.resourceUriString(),
  }),
);

type main$schematype = typeof _mainSchema;

export interface mainSchema extends main$schematype {}

export const mainSchema = _mainSchema as mainSchema;

export interface Main extends v.InferInput<typeof mainSchema> {}

declare module "@atcute/lexicons/ambient" {
  interface Records {
    "com.nickthesick.catnip.star": mainSchema;
  }
}
