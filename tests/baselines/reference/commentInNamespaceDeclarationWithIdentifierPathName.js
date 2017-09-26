//// [commentInNamespaceDeclarationWithIdentifierPathName.ts]
namespace hello.hi.world
{
    function foo() {}

    // TODO , blah id:298 gh:299
}

//// [commentInNamespaceDeclarationWithIdentifierPathName.js]
var hello;
(function (hello) {
    var hi;
    (function (hi) {
        var world;
        (function (world) {
            function foo() { }
            // TODO , blah id:258 gh:259
        })(world = hi.world || (hi.world = {}));
    })(hi = hello.hi || (hello.hi = {}));
})(hello || (hello = {}));
