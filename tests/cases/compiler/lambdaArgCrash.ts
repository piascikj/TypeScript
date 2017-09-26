class Event {

	 private _listeners: any[] = [];

	 constructor () {

		 // TODO: remove id:404 gh:405

		 this._listeners = [];

	}

	 add(listener: () => any): void {

		 /// <summary>Registers a new listener for the event.</summary>

		 /// <param name="listener">The callback function to register.</param>

		 this._listeners.push(listener);

	}

}
 
class ItemSetEvent extends Event {

	 add(listener: (items: ItemSet) => void ) {

	 	super.add(listener);

	}

}
