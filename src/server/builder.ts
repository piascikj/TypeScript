/// <reference path="..\compiler\commandLineParser.ts" />
/// <reference path="..\services\services.ts" />
/// <reference path="session.ts" />

namespace ts.server {

    export function shouldEmitFile(scriptInfo: ScriptInfo) {
        return !scriptInfo.hasMixedContent && !scriptInfo.isDynamic;
    }

    /**
     * An abstract file info that maintains a shape signature.
     */
    export class BuilderFileInfo {

        private lastCheckedShapeSignature: string;

        constructor(public readonly scriptInfo: ScriptInfo, public readonly project: Project) {
        }

        public isExternalModuleOrHasOnlyAmbientExternalModules() {
            const sourceFile = this.getSourceFile();
            return isExternalModule(sourceFile) || this.containsOnlyAmbientModules(sourceFile);
        }

        /**
         * For script files that contains only ambient external modules, although they are not actually external module files,
         * they can only be consumed via importing elements from them. Regular script files cannot consume them. Therefore,
         * there are no point to rebuild all script files if these special files have changed. However, if any statement
         * in the file is not ambient external module, we treat it as a regular script file.
         */
        private containsOnlyAmbientModules(sourceFile: SourceFile) {
            for (const statement of sourceFile.statements) {
                if (statement.kind !== SyntaxKind.ModuleDeclaration || (<ModuleDeclaration>statement).name.kind !== SyntaxKind.StringLiteral) {
                    return false;
                }
            }
            return true;
        }

        private computeHash(text: string): string {
            return this.project.projectService.host.createHash(text);
        }

        private getSourceFile(): SourceFile {
            return this.project.getSourceFile(this.scriptInfo.path);
        }

        /**
         * @return {boolean} indicates if the shape signature has changed since last update.
         */
        public updateShapeSignature() {
            const sourceFile = this.getSourceFile();
            if (!sourceFile) {
                return true;
            }

            const lastSignature = this.lastCheckedShapeSignature;
            if (sourceFile.isDeclarationFile) {
                this.lastCheckedShapeSignature = this.computeHash(sourceFile.text);
            }
            else {
                const emitOutput = this.project.getFileEmitOutput(this.scriptInfo, /*emitOnlyDtsFiles*/ true);
                if (emitOutput.outputFiles && emitOutput.outputFiles.length > 0) {
                    this.lastCheckedShapeSignature = this.computeHash(emitOutput.outputFiles[0].text);
                }
            }
            return !lastSignature || this.lastCheckedShapeSignature !== lastSignature;
        }
    }

    export interface Builder {
        readonly project: Project;
        getFilesAffectedBy(scriptInfo: ScriptInfo): string[];
        onProjectUpdateGraph(): void;
        emitFile(scriptInfo: ScriptInfo, writeFile: (path: string, data: string, writeByteOrderMark?: boolean) => void): boolean;
        clear(): void;
    }

    abstract class AbstractBuilder<T extends BuilderFileInfo> implements Builder {

        /**
         * stores set of files from the project.
         * NOTE: this field is created on demand and should not be accessed directly. id:236 gh:237
         * Use 'getFileInfos' instead.
         */
        private fileInfos_doNotAccessDirectly: Map<T>;

        constructor(public readonly project: Project, private ctor: { new (scriptInfo: ScriptInfo, project: Project): T }) {
        }

        private getFileInfos() {
            return this.fileInfos_doNotAccessDirectly || (this.fileInfos_doNotAccessDirectly = createMap<T>());
        }

        protected hasFileInfos() {
            return !!this.fileInfos_doNotAccessDirectly;
        }

        public clear() {
            // drop the existing list - it will be re-created as necessary
            this.fileInfos_doNotAccessDirectly = undefined;
        }

        protected getFileInfo(path: Path): T {
            return this.getFileInfos().get(path);
        }

        protected getOrCreateFileInfo(path: Path): T {
            let fileInfo = this.getFileInfo(path);
            if (!fileInfo) {
                const scriptInfo = this.project.getScriptInfo(path);
                fileInfo = new this.ctor(scriptInfo, this.project);
                this.setFileInfo(path, fileInfo);
            }
            return fileInfo;
        }

        protected getFileInfoPaths(): Path[] {
            return arrayFrom(this.getFileInfos().keys() as Iterator<Path>);
        }

        protected setFileInfo(path: Path, info: T) {
            this.getFileInfos().set(path, info);
        }

        protected removeFileInfo(path: Path) {
            this.getFileInfos().delete(path);
        }

        protected forEachFileInfo(action: (fileInfo: T) => any) {
            this.getFileInfos().forEach(action);
        }

        abstract getFilesAffectedBy(scriptInfo: ScriptInfo): string[];
        abstract onProjectUpdateGraph(): void;
        protected abstract ensureFileInfoIfInProject(scriptInfo: ScriptInfo): void;

        /**
         * @returns {boolean} whether the emit was conducted or not
         */
        emitFile(scriptInfo: ScriptInfo, writeFile: (path: string, data: string, writeByteOrderMark?: boolean) => void): boolean {
            this.ensureFileInfoIfInProject(scriptInfo);
            const fileInfo = this.getFileInfo(scriptInfo.path);
            if (!fileInfo) {
                return false;
            }

            const { emitSkipped, outputFiles } = this.project.getFileEmitOutput(fileInfo.scriptInfo, /*emitOnlyDtsFiles*/ false);
            if (!emitSkipped) {
                const projectRootPath = this.project.getProjectRootPath();
                for (const outputFile of outputFiles) {
                    const outputFileAbsoluteFileName = getNormalizedAbsolutePath(outputFile.name, projectRootPath ? projectRootPath : getDirectoryPath(scriptInfo.fileName));
                    writeFile(outputFileAbsoluteFileName, outputFile.text, outputFile.writeByteOrderMark);
                }
            }
            return !emitSkipped;
        }
    }

    class NonModuleBuilder extends AbstractBuilder<BuilderFileInfo> {

        constructor(public readonly project: Project) {
            super(project, BuilderFileInfo);
        }

        protected ensureFileInfoIfInProject(scriptInfo: ScriptInfo) {
            if (this.project.containsScriptInfo(scriptInfo)) {
                this.getOrCreateFileInfo(scriptInfo.path);
            }
        }

        onProjectUpdateGraph() {
            if (this.hasFileInfos()) {
                this.forEachFileInfo(fileInfo => {
                    if (!this.project.containsScriptInfo(fileInfo.scriptInfo)) {
                        // This file was deleted from this project
                        this.removeFileInfo(fileInfo.scriptInfo.path);
                    }
                });
            }
        }

        /**
         * Note: didn't use path as parameter because the returned file names will be directly
         * consumed by the API user, which will use it to interact with file systems. Path
         * should only be used internally, because the case sensitivity is not trustable.
         */
        getFilesAffectedBy(scriptInfo: ScriptInfo): string[] {
            const info = this.getOrCreateFileInfo(scriptInfo.path);
            const singleFileResult = scriptInfo.hasMixedContent || scriptInfo.isDynamic ? [] : [scriptInfo.fileName];
            if (info.updateShapeSignature()) {
                const options = this.project.getCompilerOptions();
                // If `--out` or `--outFile` is specified, any new emit will result in re-emitting the entire project,
                // so returning the file itself is good enough.
                if (options && (options.out || options.outFile)) {
                    return singleFileResult;
                }
                return this.project.getAllEmittableFiles();
            }
            return singleFileResult;
        }
    }

    class ModuleBuilderFileInfo extends BuilderFileInfo {
        references = createSortedArray<ModuleBuilderFileInfo>();
        readonly referencedBy = createSortedArray<ModuleBuilderFileInfo>();
        scriptVersionForReferences: string;

        static compareFileInfos(lf: ModuleBuilderFileInfo, rf: ModuleBuilderFileInfo): Comparison {
            return compareStrings(lf.scriptInfo.fileName, rf.scriptInfo.fileName);
        }

        addReferencedBy(fileInfo: ModuleBuilderFileInfo): void {
            insertSorted(this.referencedBy, fileInfo, ModuleBuilderFileInfo.compareFileInfos);
        }

        removeReferencedBy(fileInfo: ModuleBuilderFileInfo): void {
            removeSorted(this.referencedBy, fileInfo, ModuleBuilderFileInfo.compareFileInfos);
        }

        removeFileReferences() {
            for (const reference of this.references) {
                reference.removeReferencedBy(this);
            }
            clear(this.references);
        }
    }

    class ModuleBuilder extends AbstractBuilder<ModuleBuilderFileInfo> {

        constructor(public readonly project: Project) {
            super(project, ModuleBuilderFileInfo);
        }

        private projectVersionForDependencyGraph: string;

        public clear() {
            this.projectVersionForDependencyGraph = undefined;
            super.clear();
        }

        private getReferencedFileInfos(fileInfo: ModuleBuilderFileInfo): SortedArray<ModuleBuilderFileInfo> {
            if (!fileInfo.isExternalModuleOrHasOnlyAmbientExternalModules()) {
                return createSortedArray();
            }

            const referencedFilePaths = this.project.getReferencedFiles(fileInfo.scriptInfo.path);
            return toSortedArray(referencedFilePaths.map(f => this.getOrCreateFileInfo(f)), ModuleBuilderFileInfo.compareFileInfos);
        }

        protected ensureFileInfoIfInProject(_scriptInfo: ScriptInfo) {
            this.ensureProjectDependencyGraphUpToDate();
        }

        onProjectUpdateGraph() {
            // Update the graph only if we have computed graph earlier
            if (this.hasFileInfos()) {
                this.ensureProjectDependencyGraphUpToDate();
            }
        }

        private ensureProjectDependencyGraphUpToDate() {
            if (!this.projectVersionForDependencyGraph || this.project.getProjectVersion() !== this.projectVersionForDependencyGraph) {
                const currentScriptInfos = this.project.getScriptInfos();
                for (const scriptInfo of currentScriptInfos) {
                    const fileInfo = this.getOrCreateFileInfo(scriptInfo.path);
                    this.updateFileReferences(fileInfo);
                }
                this.forEachFileInfo(fileInfo => {
                    if (!this.project.containsScriptInfo(fileInfo.scriptInfo)) {
                        // This file was deleted from this project
                        fileInfo.removeFileReferences();
                        this.removeFileInfo(fileInfo.scriptInfo.path);
                    }
                });
                this.projectVersionForDependencyGraph = this.project.getProjectVersion();
            }
        }

        private updateFileReferences(fileInfo: ModuleBuilderFileInfo) {
            // Only need to update if the content of the file changed.
            if (fileInfo.scriptVersionForReferences === fileInfo.scriptInfo.getLatestVersion()) {
                return;
            }

            const newReferences = this.getReferencedFileInfos(fileInfo);
            const oldReferences = fileInfo.references;
            enumerateInsertsAndDeletes(newReferences, oldReferences,
                /*inserted*/ newReference => newReference.addReferencedBy(fileInfo),
                /*deleted*/ oldReference => {
                    // New reference is greater then current reference. That means
                    // the current reference doesn't exist anymore after parsing. So delete
                    // references.
                    oldReference.removeReferencedBy(fileInfo);
                },
                /*compare*/ ModuleBuilderFileInfo.compareFileInfos);

            fileInfo.references = newReferences;
            fileInfo.scriptVersionForReferences = fileInfo.scriptInfo.getLatestVersion();
        }

        getFilesAffectedBy(scriptInfo: ScriptInfo): string[] {
            this.ensureProjectDependencyGraphUpToDate();

            const singleFileResult = scriptInfo.hasMixedContent || scriptInfo.isDynamic ? [] : [scriptInfo.fileName];
            const fileInfo = this.getFileInfo(scriptInfo.path);
            if (!fileInfo || !fileInfo.updateShapeSignature()) {
                return singleFileResult;
            }

            if (!fileInfo.isExternalModuleOrHasOnlyAmbientExternalModules()) {
                return this.project.getAllEmittableFiles();
            }

            const options = this.project.getCompilerOptions();
            if (options && (options.isolatedModules || options.out || options.outFile)) {
                return singleFileResult;
            }

            // Now we need to if each file in the referencedBy list has a shape change as well.
            // Because if so, its own referencedBy files need to be saved as well to make the
            // emitting result consistent with files on disk.

            // Use slice to clone the array to avoid manipulating in place
            const queue = fileInfo.referencedBy.slice(0);
            const fileNameSet = createMap<ScriptInfo>();
            fileNameSet.set(scriptInfo.fileName, scriptInfo);
            while (queue.length > 0) {
                const processingFileInfo = queue.pop();
                if (processingFileInfo.updateShapeSignature() && processingFileInfo.referencedBy.length > 0) {
                    for (const potentialFileInfo of processingFileInfo.referencedBy) {
                        if (!fileNameSet.has(potentialFileInfo.scriptInfo.fileName)) {
                            queue.push(potentialFileInfo);
                        }
                    }
                }
                fileNameSet.set(processingFileInfo.scriptInfo.fileName, processingFileInfo.scriptInfo);
            }
            const result: string[] = [];
            fileNameSet.forEach((scriptInfo, fileName) => {
                if (shouldEmitFile(scriptInfo)) {
                    result.push(fileName);
                }
            });
            return result;
        }
    }

    export function createBuilder(project: Project): Builder {
        const moduleKind = project.getCompilerOptions().module;
        switch (moduleKind) {
            case ModuleKind.None:
                return new NonModuleBuilder(project);
            default:
                return new ModuleBuilder(project);
        }
    }
}
