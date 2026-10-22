import { Route, Switch } from "wouter";
import {
  PortalArticle, PortalCatalog, PortalCatalogItem, PortalHome, PortalKnowledge, PortalMy, PortalReport, PortalStatus,
} from "./portal";
import { IssueDetail, RequestDetail } from "./work";
import {
  ConsoleApprovals, ConsoleAssets, ConsoleCatalog, ConsoleChanges, ConsoleKnowledge, ConsoleMajor, ConsoleOverview,
  ConsoleProblems, ConsoleQueue, ConsoleRequests,
} from "./console";
import { PortalLayout } from "./ItLayout";
import { Empty } from "./ui";

/** DEJOIY IT: the employee portal under /it and the IT console under /it/console. */
export default function ItApp() {
  return (
    <Switch>
      <Route path="/it" component={PortalHome} />
      <Route path="/it/catalog" component={PortalCatalog} />
      <Route path="/it/catalog/:id" component={PortalCatalogItem} />
      <Route path="/it/report" component={PortalReport} />
      <Route path="/it/my" component={PortalMy} />
      <Route path="/it/requests/:id">{() => <RequestDetail />}</Route>
      <Route path="/it/issues/:id">{() => <IssueDetail />}</Route>
      <Route path="/it/knowledge" component={PortalKnowledge} />
      <Route path="/it/knowledge/:id" component={PortalArticle} />
      <Route path="/it/status" component={PortalStatus} />

      <Route path="/it/console" component={ConsoleOverview} />
      <Route path="/it/console/queue" component={ConsoleQueue} />
      <Route path="/it/console/queue/:id">{() => <IssueDetail console />}</Route>
      <Route path="/it/console/requests" component={ConsoleRequests} />
      <Route path="/it/console/requests/:id">{() => <RequestDetail console />}</Route>
      <Route path="/it/console/approvals" component={ConsoleApprovals} />
      <Route path="/it/console/major" component={ConsoleMajor} />
      <Route path="/it/console/problems" component={ConsoleProblems} />
      <Route path="/it/console/changes" component={ConsoleChanges} />
      <Route path="/it/console/assets" component={ConsoleAssets} />
      <Route path="/it/console/catalog" component={ConsoleCatalog} />
      <Route path="/it/console/knowledge" component={ConsoleKnowledge} />

      <Route>
        <PortalLayout>
          <Empty title="That page doesn't exist">
            <a href="/it" className="it-link">Back to IT home</a>
          </Empty>
        </PortalLayout>
      </Route>
    </Switch>
  );
}
