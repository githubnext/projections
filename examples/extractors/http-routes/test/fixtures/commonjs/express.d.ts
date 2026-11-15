declare module "express" {
  function express(): express.Application;
  namespace express { interface Application { get(path: string, handler: Function): void } function Router(): Application; }
  export = express;
}
