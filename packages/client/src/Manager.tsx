import React, { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";

import Alert from "@mui/material/Alert";
import LinearProgress from "@mui/material/LinearProgress";
import Snackbar from "@mui/material/Snackbar";
import Typography from "@mui/material/Typography";

import AboutDialog from "./AboutDialog";
import CreateListDialog from "./CreateListDialog";
import DeleteListDialog from "./DeleteListDialog";
import TimeoutDialog from "./TimeoutDialog";
import ExportListDialog from "./ExportListDialog";
import ImportListDialog from "./ImportListDialog";
import AnalyticsDialog from "./AnalyticsDialog";

import FollowingTable from "./FollowingTable";
import Controls from "./Controls";
import TopBar from "./TopBar";

import { saveAs } from "file-saver";

import {
  User,
  APIData,
  Group,
  List,
  InProgress,
  AuthError,
  TimeoutError,
} from "@mastodonlm/shared";

// For our API work
import type APIWorker from "./clientworker";
import * as Comlink from "comlink";

import "./Manager.css";

// Helper functions for timing things
function getTime() {
  return new Date().getTime();
}
function getElapsed(startTime: number) {
  return new Date().getTime() - startTime;
}

function info2Groups(
  info: APIData,
  by: string,
  filter: string,
  search: string
) {
  // First, compute the groups
  const getGroupName = (fol: User) => fol.display_name.toUpperCase()[0];
  const getGroupNone = (fol: User) => "All";
  const getGroupDomain = (fol: User) => {
    const arr = fol.acct.match(/@(.*)/) || ["", "(home)"];
    return arr[1];
  };
  const methods: Record<string, (a: User) => string> = {
    none: getGroupNone,
    name: getGroupName,
    domain: getGroupDomain,
  };
  const method = methods[by];
  const groups: Record<string, User[]> = {};

  const lwrSearch = search.toLowerCase();

  // Returns true if the filter keeps a person
  const key = filter.split(":")[0];
  const filterFuncs: Record<string, (x: User) => boolean> = {
    nolists: (x) => x.lists.length === 0,
    not: (x) => !x.lists.includes(filter.slice(4)),
    on: (x) => x.lists.includes(filter.slice(3)),
  };
  const filterFunc = filterFuncs[key] || ((x: User) => true);

  info.followers.forEach((fol: User) => {
    // First, see if it passes the filter
    if (!filterFunc(fol)) return;

    // Next, see if it passes the search
    const dnidx = fol.display_name.toLowerCase().indexOf(lwrSearch);
    const unidx = fol.username.toLowerCase().indexOf(lwrSearch);
    const noidx = fol.note.toLowerCase().indexOf(lwrSearch);

    if (dnidx === -1 && unidx === -1 && noidx === -1) return;

    const g = method(fol);
    if (!groups[g]) {
      groups[g] = [];
    }
    groups[g].push(fol);
  });
  // Now, order the groups and produce an array
  const keys = Object.keys(groups);
  keys.sort();
  return keys.map((k) => ({ key: k, followers: groups[k] }));
}

type ManagerProps = {
  api: Promise<Comlink.Remote<APIWorker>>;
};

function Manager({ api }: ManagerProps) {
  // The data
  const [info, setInfo] = useState<APIData>({
    lists: [],
    followers: [],
    me: {
      id: "",
      display_name: "",
      username: "",
      avatar: "",
      acct: "",
      note: "",
      following_count: 0,
      lists: [],
    },
  });
  // The grouped data - as an array of info objects.
  const [groups, setGroups] = useState<Group[]>([]);
  // How we want things grouped
  const [groupBy, setGroupBy] = useState("none");
  // Whether or not to display the loading indicator
  const [loading, setLoading] = useState(false);
  // The currently active filter
  // Values: "everything", "nolists", "not:list-id"
  const [filter, setFilter] = useState("everything");
  // For searching
  const [search, setSearch] = useState("");
  // For showing in progress actions
  const [inProgress, setInProgress] = useState<InProgress | null>(null);
  // For errors
  const [error, setError] = useState<string | null>(null);
  // To show a special timeout message
  const [showTimeout, setShowTimeout] = useState(false);
  //
  const [loadProgress, setLoadProgress] = useState(0);

  // An error handler for API methods that we call.
  const handleError = (err: Error) => {
    if (err instanceof TimeoutError) {
      setShowTimeout(true);
    } else if (err instanceof AuthError) {
      setRedirect("/login");
    } else {
      setError(`Some other error happened: ${err.message}`);
    }
  };

  const progress = (value: number) => {
    setLoadProgress(value);
  };

  const telemetryCB = useCallback(
    async (data: Record<string, any>) => {
      const remote = await api;
      remote.telemetry(data);
    },
    [api]
  );

  const errorCB = useCallback(
    async (error: Error) => {
      const data = {
        stack: error.stack,
        message: error.message,
      };
      const remote = await api;
      remote.error(data);
    },
    [api]
  );

  const importCB = useCallback(
    async (list_name: string, data: string[]) => {
      const startTime = getTime();
      const remote = await api;
      remote.importList(list_name, data).then(() => {
        const elapsedMS = getElapsed(startTime);
        const telem = {
          action: "import",
          num_imported: data.length,
          elapsed_ms: elapsedMS,
        };
        telemetryCB(telem);
      });
    },
    [api, telemetryCB]
  );

  const loadDataCB = useCallback(async () => {
    setLoading(true);
    setLoadProgress(0);
    const startTime = getTime();

    const remote = await api;
    remote
      .info(Comlink.proxy(progress))
      .then((data: APIData) => {
        data.followers.forEach((f) => {
          if (f.display_name === "") f.display_name = f.username;
        });
        data.followers.sort((a, b) =>
          a.display_name.localeCompare(b.display_name)
        );
        data.lists.sort((a, b) => a.title.localeCompare(b.title));
        setInfo(data);
        setLoading(false);
        return data;
      })
      .then((data) => {
        // Compute list sizes
        const list_sizes = data.lists.map((list) => {
          const fols = data.followers.filter((fol) =>
            fol.lists.includes(list.id)
          );
          return fols.length;
        });
        const elapsedMS = getElapsed(startTime);
        const telem = {
          action: "info",
          num_following: data.followers.length,
          num_lists: data.lists.length,
          list_sizes: list_sizes,
          elapsed_ms: elapsedMS,
        };
        telemetryCB(telem);
      })
      .catch((err) => {
        handleError(err);
        setLoading(false);
        errorCB(err);
      });
  }, [api, telemetryCB, errorCB]);

  const logoutCB = useCallback(async () => {
    const remote = await api;
    return remote.logout();
  }, [api]);

  const createListCB = useCallback(
    async (name: string) => {
      const remote = await api;
      return remote.createList(name);
    },
    [api]
  );

  const deleteListCB = useCallback(
    async (list_id: string) => {
      const remote = await api;
      return remote.deleteList(list_id);
    },
    [api]
  );

  // Generate the groups
  useEffect(() => {
    const startTime = new Date().getTime();
    const groups = info2Groups(info, groupBy, filter, search);
    setGroups(groups);
    const gtotal = groups
      .map((x) => x.followers.length)
      .reduce((a, b) => a + b, 0);
    const total = info.followers.length;
    const perc = Math.round((100 * gtotal) / total);
    if (perc !== 100) {
      const endTime = new Date().getTime();
      const elapsedMS = endTime - startTime;
      telemetryCB({
        action: "filter_result",
        value: perc,
        elapsed_ms: elapsedMS,
      });
    }
  }, [info, groupBy, search, filter, telemetryCB]);

  // Fetch the data
  useEffect(() => {
    loadDataCB();
    // eslint-disable-next-line
  }, []);

  // A redirect if we need it
  const [redirect, setRedirect] = useState<string | null>(null);

  // Menu anchor and handlers
  const handleMenuAbout = () => {
    setAboutOpen(true);
  };
  const handleMenuNewList = () => {
    setCreateOpen(true);
  };
  const handleMenuExportList = () => {
    setExportOpen(true);
  };
  const handleLogout = () => {
    logoutCB().then(() => setRedirect("/main"));
  };

  // About dialog handlers
  const [aboutOpen, setAboutOpen] = useState(false);
  const handleAboutClose = () => {
    setAboutOpen(false);
  };

  // Analytics Dialog handlers
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [analyticsList, setAnalyticsList] = useState<List | null>(null);
  const handleAnalyticsClick = (list: List) => {
    setAnalyticsList(list);
    setAnalyticsOpen(true);
  };
  const handleAnalyticsClose = () => {
    setAnalyticsOpen(false);
  };

  // Create List Dialog
  const [createOpen, setCreateOpen] = useState(false);
  const handleCreateClose = () => {
    setCreateOpen(false);
  };
  const handleCreateCommit = (name: string) => {
    const startTime = getTime();
    setCreateOpen(false);
    createListCB(name)
      .then((list: List) => {
        const newInfo: APIData = { ...info };
        newInfo.lists.push(list);
        setInfo(newInfo);
        const elapsedMS = getElapsed(startTime);
        telemetryCB({ action: "create_list", elapsed_ms: elapsedMS });
      })
      .catch((err) => handleError(err));
  };

  // Export List Dialog
  const [exportOpen, setExportOpen] = useState(false);
  const handleExportList = (list: List) => {
    // Filter to just this list.
    const startTime = getTime();
    const filtered = info.followers.filter((x) => x.lists.includes(list.id));
    const accts = filtered.map((x) => x.acct);
    const data = ["account"].concat(accts);
    var blob = new Blob([data.join("\n")], { type: "text/csv;charset=utf-8" });
    saveAs(blob, "export.csv");
    const elapsedMS = getElapsed(startTime);
    const telem = {
      action: "export",
      num_exported: accts.length,
      elapsed_ms: elapsedMS,
    };
    telemetryCB(telem);
  };

  // Import list dialog
  const [importOpen, setImportOpen] = useState(false);
  const handleMenuImportList = () => {
    setImportOpen(true);
  };
  const handleImportList = (list_name: string, data: string[]) => {
    // Figure out which people I'm not following
    const followerMap: Record<string, User> = {};
    info.followers.forEach((x) => {
      followerMap[x.acct] = x;
    });

    //const toFollow = data.filter((x) => !(x in followerMap));
    //const toAdd = data.filter((x) => x in followerMap);
    //console.log("To follow (not implemented):");
    //console.log(toFollow);

    // Pass this off to our API, which will do the heavy lifting.
    importCB(list_name, data).then(() => loadDataCB());
  };

  // Build the crazy table.
  const lists = info.lists;

  // Delete list dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteList, setDeleteList] = useState<List | null>(null);
  const handleDeleteClose = () => {
    setDeleteOpen(false);
  };
  const handleDeleteClick = (list: List) => {
    setDeleteList(list);
    setDeleteOpen(true);
  };
  const handleDelete = (list: List) => {
    const startTime = getTime();
    deleteListCB(list.id)
      .then(() => {
        const newInfo = { ...info };
        newInfo.lists = info.lists.filter((x) => x.id !== list.id);
        newInfo.followers.forEach((fol) => {
          fol.lists = fol.lists.filter((x) => x !== list.id);
        });
        setInfo(newInfo);
      })
      .then(() => setDeleteOpen(false))
      .then(() => {
        const elapsedMS = getElapsed(startTime);
        telemetryCB({ action: "delete_list", elapsed_ms: elapsedMS });
      })
      .catch((err) => handleError(err));
  };

  const remove = async (groupIndex: number, index: number, lid: string) => {
    const startTime = getTime();
    const newGroups = groups.slice();
    const fol = newGroups[groupIndex].followers[index];
    const use = await api;
    setInProgress({ list: lid, follower: fol.id });
    fol.lists = fol.lists.filter((value) => value !== lid);
    await use
      .removeFromList(lid, fol.id)
      .then((resp) => {
        setInProgress(null);
        setGroups(newGroups);
        const elapsedMS = getElapsed(startTime);
        telemetryCB({ action: "remove", elapsed_ms: elapsedMS });
      })
      .catch((err) => handleError(err));
  };

  const add = async (groupIndex: number, index: number, lid: string) => {
    const startTime = getTime();
    const newGroups = groups.slice();
    const fol = newGroups[groupIndex].followers[index];
    fol.lists.push(lid);
    const use = await api;
    setInProgress({ list: lid, follower: fol.id });
    await use
      .addToList(lid, fol.id)
      .then((data) => {
        setInProgress(null);
        setGroups(newGroups);
        const elapsedMS = getElapsed(startTime);
        telemetryCB({ action: "add", elapsed_ms: elapsedMS });
      })
      .catch((err) => {
        handleError(err);
        setInProgress(null);
      });
  };

  const handlePageSizeChange = (ps: number) => {
    console.log(ps);
    localStorage.setItem("list-manager-pagesize", ps.toString());
    setPageSize(ps);
  };
  const [pageSize, setPageSize] = useState(
    parseInt(localStorage.getItem("list-manager-pagesize") || "500")
  );

  // Build one table per group.
  const tables = groups.map((group, gindex) => {
    return (
      <FollowingTable
        key={group.key}
        groupIndex={gindex}
        group={group}
        lists={lists}
        inProgress={inProgress}
        remove={remove}
        add={add}
        handleDeleteClick={handleDeleteClick}
        handleInfoClick={handleAnalyticsClick}
        defaultOpen={groups.length === 1}
        pageSize={pageSize}
        onNewList={() => {
          setCreateOpen(true);
        }}
      />
    );
  });

  if (redirect) {
    return <Navigate to={redirect} />;
  }

  const acct = info.me ? info.me.acct : "";
  const appbar = (
    <TopBar
      acct={acct}
      handleMenuAbout={handleMenuAbout}
      handleMenuExportList={handleMenuExportList}
      handleMenuImportList={handleMenuImportList}
      handleMenuNewList={handleMenuNewList}
      handleMenuLogout={handleLogout}
    />
  );

  const handleGroupBy = (groupby: string) => {
    setGroupBy(groupby);
    telemetryCB({ action: "groupby", groupby: groupby });
  };

  const handleFilter = (filter: string) => {
    setFilter(filter);
    telemetryCB({ action: "filter", filter: filter });
  };

  const controls = (
    <Controls
      groupBy={groupBy}
      handleGroupByChange={handleGroupBy}
      lists={lists}
      filter={filter}
      handleFilterChange={handleFilter}
      search={search}
      handleSearchChange={setSearch}
      refresh={loadDataCB}
      pageSize={pageSize}
      handlePageSizeChange={handlePageSizeChange}
    />
  );

  const snackbar = (
    <Snackbar
      open={error !== null}
      autoHideDuration={6000}
      onClose={() => setError(null)}
    >
      <Alert
        onClose={() => setError(null)}
        severity="error"
        sx={{ width: "100%" }}
      >
        {error}
      </Alert>
    </Snackbar>
  );

  const reload = (
    <Typography>
      Hmm. There's no data here. Create a new list, or try reloading!
    </Typography>
  );

  const dialogs = (
    <div>
      <AboutDialog open={aboutOpen} handleClose={handleAboutClose} />
      <CreateListDialog
        open={createOpen}
        handleClose={handleCreateClose}
        handleCreate={handleCreateCommit}
      />
      {deleteList ? (
        <DeleteListDialog
          open={deleteOpen}
          list={deleteList}
          handleClose={handleDeleteClose}
          handleDelete={handleDelete}
        />
      ) : (
        <span />
      )}
      <TimeoutDialog
        open={showTimeout}
        handleClose={() => setShowTimeout(false)}
      />
      <ExportListDialog
        open={exportOpen}
        lists={info.lists}
        handleExport={handleExportList}
        handleClose={() => setExportOpen(false)}
      />
      <ImportListDialog
        open={importOpen}
        handleImport={handleImportList}
        handleClose={() => setImportOpen(false)}
      />
      <AnalyticsDialog
        open={analyticsOpen}
        list={analyticsList}
        api={api}
        key={analyticsList ? analyticsList.id : "none"}
        handleClose={handleAnalyticsClose}
      />
    </div>
  );

  return (
    <div className="Manager">
      <div id="topbars">
        {appbar}
        {loading ? (
          <LinearProgress variant="determinate" value={loadProgress} />
        ) : (
          ""
        )}
        {controls}
      </div>
      <div id="alltables">
        {tables}
        {tables.length === 0 && !loading ? reload : ""}
        {snackbar}
        {dialogs}
      </div>
    </div>
  );
}

export default Manager;