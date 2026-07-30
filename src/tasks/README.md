# Tasks module location

Workers may write claims only in their selected task directory in external run
state. `result-claim.js` reads the explicit outcome slot; `/route` remains the
only graph writer and never creates or edits a worker claim. `evidence-claim.js`
checks only the worker claim's structural shape before `/route` records its path.
