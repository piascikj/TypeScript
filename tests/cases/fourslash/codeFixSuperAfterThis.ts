/// <reference path='fourslash.ts' />

////class Base{
////}
////class C extends Base{
////    private a:number;
////    constructor() {[|
////        this.a = 12;
////        super();
////    |]}
////}
// TODO: GH#18445 id:504 gh:505
verify.rangeAfterCodeFix(`
        super();\r
        this.a = 12;
    `, /*includeWhiteSpace*/ true);
